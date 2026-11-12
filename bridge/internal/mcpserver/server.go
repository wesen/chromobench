// Package mcpserver is chromobench's MCP server (CHB-008 guide §5.5): one `eval` tool whose input is the body of an
// async JavaScript function run in the photographer's darkroom, `status` and `create_session`, the generated
// instructions, reference and eval-tool description (from the op registry, via tools/gen-docs), and the
// `chromobench-agent` prompt. Built on the official Go SDK, structured after goja-cv's cvsession/mcp.go.
package mcpserver

import (
	"context"
	"embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/wesen/chromobench/bridge/internal/hub"
)

//go:embed generated/*.md generated/*.txt generated/playbooks/*.js
var generatedFS embed.FS

// Generated holds the texts tools/gen-docs writes into generated/.
type Generated struct {
	Instructions        string
	Reference           string
	EvalToolDescription string
	// Playbooks: name → source (packages/agent/playbooks/*.js); an agent loads one by sending it as an eval.
	Playbooks map[string]string
}

// Embedded returns the generated texts compiled into the binary.
func Embedded() Generated {
	read := func(name string) string {
		b, err := generatedFS.ReadFile("generated/" + name)
		if err != nil {
			panic(err)
		}
		return string(b)
	}
	g := Generated{Instructions: read("instructions.md"), Reference: read("reference.md"), EvalToolDescription: strings.TrimSpace(read("eval-tool.txt")), Playbooks: map[string]string{}}
	entries, _ := generatedFS.ReadDir("generated/playbooks")
	for _, e := range entries {
		g.Playbooks[strings.TrimSuffix(e.Name(), ".js")] = read("playbooks/" + e.Name())
	}
	return g
}

// Backend runs evals: the in-process hub, or a running bridge over HTTP (attach mode).
type Backend interface {
	Eval(ctx context.Context, c hub.EvalCall) (hub.Result, error)
	CreateSession(ctx context.Context) (string, error)
	Status(ctx context.Context) ([]hub.PageStatus, error)
}

// HubBackend adapts a hub.
type HubBackend struct{ H *hub.Hub }

func (b HubBackend) Eval(ctx context.Context, c hub.EvalCall) (hub.Result, error) { return b.H.Eval(ctx, c) }
func (b HubBackend) CreateSession(ctx context.Context) (string, error)            { return b.H.CreateSession(ctx) }
func (b HubBackend) Status(context.Context) ([]hub.PageStatus, error)             { return b.H.Status(), nil }

// EvalInput is the eval tool's input. The descriptions tell agents when to omit the optional fields: agents
// invent values for unexplained options (goja-cv).
type EvalInput struct {
	Code      string `json:"code" jsonschema:"JavaScript run in the photographer's darkroom: the body of an async function. Use await and end with return."`
	SessionID string `json:"sessionId,omitempty" jsonschema:"Optional; omit it to use the default session (where mem lives). Only pass ids returned by create_session."`
	Frame     string `json:"frame,omitempty" jsonschema:"Optional; omit it to work on the frame the photographer has open. Pass a frame id from status only to work on another frame."`
	TimeoutMs int    `json:"timeoutMs,omitempty" jsonschema:"Optional; omit it for the default of 30000 ms. Raise it (at most 120000) only for full-resolution measurements."`
}

type noInput struct{}

// New builds the server.
func New(b Backend, gen Generated, version string) *mcp.Server {
	srv := mcp.NewServer(&mcp.Implementation{Name: "chromobench", Version: version}, &mcp.ServerOptions{Instructions: gen.Instructions})
	notDestructive := false
	mcp.AddTool(srv, &mcp.Tool{
		Name: "eval", Description: gen.EvalToolDescription,
		Annotations: &mcp.ToolAnnotations{Title: "Run darkroom JavaScript", DestructiveHint: &notDestructive},
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in EvalInput) (*mcp.CallToolResult, any, error) {
		r, err := b.Eval(ctx, hub.EvalCall{Session: in.SessionID, Frame: in.Frame, Code: in.Code, TimeoutMs: in.TimeoutMs})
		if err != nil {
			return errorResult(err), nil, nil
		}
		return toolResult(r), nil, nil
	})
	mcp.AddTool(srv, &mcp.Tool{
		Name: "status", Description: "Connected studio pages, their open frames, the agent mode and sessions. Changes nothing.",
		Annotations: &mcp.ToolAnnotations{Title: "Studio status", ReadOnlyHint: true},
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ noInput) (*mcp.CallToolResult, any, error) {
		st, err := b.Status(ctx)
		if err != nil {
			return errorResult(err), nil, nil
		}
		if len(st) == 0 {
			return errorResult(hub.ErrNoPage("the studio")), nil, nil
		}
		js, _ := json.MarshalIndent(map[string]any{"pages": st}, "", "  ")
		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: string(js)}}}, nil, nil
	})
	mcp.AddTool(srv, &mcp.Tool{
		Name: "create_session", Description: "Start a fresh session with an empty mem; returns its id. Most work needs only the default session.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ noInput) (*mcp.CallToolResult, any, error) {
		id, err := b.CreateSession(ctx)
		if err != nil {
			return errorResult(err), nil, nil
		}
		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf("sessionId: %s", id)}}}, nil, nil
	})
	addMarkdown(srv, "chromobench://instructions", "instructions", "How to work in the darkroom through eval (the server instructions).", gen.Instructions)
	addMarkdown(srv, "chromobench://reference", "reference", "Every DSL call with arguments and units, generated from the op registry.", gen.Reference)
	for name, src := range gen.Playbooks {
		uri := "chromobench://playbooks/" + name
		doc := strings.SplitN(strings.TrimPrefix(src, "// "), "\n", 2)[0]
		srv.AddResource(&mcp.Resource{URI: uri, Name: "playbook " + name, Description: doc + " Load it by sending the source as one eval.", MIMEType: "text/javascript"}, func(context.Context, *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
			return &mcp.ReadResourceResult{Contents: []*mcp.ResourceContents{{URI: uri, MIMEType: "text/javascript", Text: src}}}, nil
		})
	}
	srv.AddPrompt(&mcp.Prompt{Name: "chromobench-agent", Title: "Chromobench agent instructions", Description: "The instructions plus the full DSL reference."},
		func(context.Context, *mcp.GetPromptRequest) (*mcp.GetPromptResult, error) {
			return &mcp.GetPromptResult{Description: "Chromobench agent instructions", Messages: []*mcp.PromptMessage{
				{Role: "user", Content: &mcp.TextContent{Text: gen.Instructions + "\n\n" + gen.Reference}},
			}}, nil
		})
	return srv
}

func addMarkdown(srv *mcp.Server, uri, name, desc, body string) {
	srv.AddResource(&mcp.Resource{URI: uri, Name: name, Description: desc, MIMEType: "text/markdown"}, func(context.Context, *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
		return &mcp.ReadResourceResult{Contents: []*mcp.ResourceContents{{URI: uri, MIMEType: "text/markdown", Text: body}}}, nil
	})
}

func toolResult(r hub.Result) *mcp.CallToolResult {
	res := &mcp.CallToolResult{IsError: r.IsError, Content: []mcp.Content{&mcp.TextContent{Text: r.Text}}}
	for _, l := range r.Looks {
		b, err := base64.StdEncoding.DecodeString(l.Base64)
		if err != nil {
			continue
		}
		res.Content = append(res.Content, &mcp.ImageContent{Data: b, MIMEType: l.MIME})
	}
	return res
}

func errorResult(err error) *mcp.CallToolResult {
	var he *hub.Error
	text := err.Error()
	if errors.As(err, &he) {
		text = fmt.Sprintf("error: %s\nmessage: %s", he.Code, he.Message)
	} else if errors.Is(err, context.Canceled) {
		text = "error: E_CANCELLED\nmessage: the call was cancelled; nothing it asked to change was submitted"
	}
	return &mcp.CallToolResult{IsError: true, Content: []mcp.Content{&mcp.TextContent{Text: text}}}
}
