package server

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/wesen/chromobench/bridge/internal/hub"
	"github.com/wesen/chromobench/bridge/internal/mcpserver"
)

const token = "test-token"

// a bridge on a real loopback port (the Host check needs the port), with its hub
func bridge(t *testing.T) (*hub.Hub, string) {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := l.Addr().(*net.TCPAddr).Port
	h := hub.New(fmt.Sprintf("http://127.0.0.1:%d", port))
	h.Grace = 200 * time.Millisecond
	ts := httptest.NewUnstartedServer(Handler(h, Options{Port: port, Token: token, Version: "test"}))
	ts.Listener = l
	ts.Start()
	t.Cleanup(ts.Close)
	return h, ts.URL
}

// fakePage speaks the page protocol: it answers evals with a fixed text and one PNG look, or swallows them.
type fakePage struct {
	c       *websocket.Conn
	mu      sync.Mutex
	got     []hub.BridgeMsg
	swallow bool
}

func connectPage(t *testing.T, url string, swallow bool) *fakePage {
	t.Helper()
	ctx := context.Background()
	c, _, err := websocket.Dial(ctx, strings.Replace(url, "http://", "ws://", 1)+"/ws/page", nil)
	if err != nil {
		t.Fatal(err)
	}
	focused := true
	if err := wsjson.Write(ctx, c, hub.PageMsg{T: "hello", Page: "p-1", App: "studio-test", Focused: &focused, Frames: []hub.FrameSummary{{ID: "frame_m1", Name: "m1.tif", Open: true}}, Mode: "ask"}); err != nil {
		t.Fatal(err)
	}
	p := &fakePage{c: c, swallow: swallow}
	go func() {
		for {
			var m hub.BridgeMsg
			if err := wsjson.Read(ctx, c, &m); err != nil {
				return
			}
			p.mu.Lock()
			p.got = append(p.got, m)
			p.mu.Unlock()
			switch {
			case m.T == "eval" && !p.swallow:
				png := base64.StdEncoding.EncodeToString([]byte("\x89PNG fake"))
				_ = wsjson.Write(ctx, c, hub.PageMsg{T: "eval.result", ID: m.ID, Text: "ran: " + m.Req.Code + " in " + m.Session, Looks: []hub.Look{{N: 1, Caption: "print", MIME: "image/png", Base64: png}}})
			case m.T == "session.create":
				_ = wsjson.Write(ctx, c, hub.PageMsg{T: "session.created", ID: m.ID, Session: "s-2"})
			}
		}
	}()
	t.Cleanup(func() { _ = c.Close(websocket.StatusNormalClosure, "") })
	// wait until the hub has the page
	time.Sleep(50 * time.Millisecond)
	return p
}

func (p *fakePage) messages() []hub.BridgeMsg {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]hub.BridgeMsg(nil), p.got...)
}

func mcpClient(t *testing.T, h *hub.Hub) *mcp.ClientSession {
	t.Helper()
	ctx := context.Background()
	srv := mcpserver.New(mcpserver.HubBackend{H: h}, mcpserver.Embedded(), "test")
	st, ct := mcp.NewInMemoryTransports()
	if _, err := srv.Connect(ctx, st, nil); err != nil {
		t.Fatal(err)
	}
	cs, err := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "test"}, nil).Connect(ctx, ct, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cs.Close() })
	return cs
}

func text(r *mcp.CallToolResult) string {
	var b strings.Builder
	for _, c := range r.Content {
		if tc, ok := c.(*mcp.TextContent); ok {
			b.WriteString(tc.Text)
		}
	}
	return b.String()
}

func TestToolsResourcesPromptAndInstructions(t *testing.T) {
	h, _ := bridge(t)
	cs := mcpClient(t, h)
	ctx := context.Background()
	tools, err := cs.ListTools(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, tl := range tools.Tools {
		names = append(names, tl.Name)
	}
	if strings.Join(names, ",") != "create_session,eval,status" {
		t.Fatalf("tools: %v", names)
	}
	gen := mcpserver.Embedded()
	if n := len(gen.Instructions); n >= 4000 || n < 1000 {
		t.Fatalf("instructions are %d characters; want 1000…3999", n)
	}
	if !strings.Contains(cs.InitializeResult().Instructions, "eval(code)") {
		t.Fatal("server instructions missing")
	}
	res, err := cs.ReadResource(ctx, &mcp.ReadResourceParams{URI: "chromobench://reference"})
	if err != nil || !strings.Contains(res.Contents[0].Text, "frame.") {
		t.Fatalf("reference resource: %v", err)
	}
	p, err := cs.GetPrompt(ctx, &mcp.GetPromptParams{Name: "chromobench-agent"})
	if err != nil || len(p.Messages) != 1 {
		t.Fatalf("prompt: %v", err)
	}
}

func TestEvalRoundTripWithLookAndStatus(t *testing.T) {
	h, url := bridge(t)
	connectPage(t, url, false)
	cs := mcpClient(t, h)
	ctx := context.Background()
	r, err := cs.CallTool(ctx, &mcp.CallToolParams{Name: "eval", Arguments: map[string]any{"code": "return 1"}})
	if err != nil {
		t.Fatal(err)
	}
	if r.IsError || text(r) != "ran: return 1 in default" {
		t.Fatalf("result: %v %q", r.IsError, text(r))
	}
	if len(r.Content) != 2 {
		t.Fatalf("want text + image, got %d blocks", len(r.Content))
	}
	img, ok := r.Content[1].(*mcp.ImageContent)
	if !ok || img.MIMEType != "image/png" || string(img.Data) != "\x89PNG fake" {
		t.Fatalf("image: %#v", r.Content[1])
	}
	st, _ := cs.CallTool(ctx, &mcp.CallToolParams{Name: "status", Arguments: map[string]any{}})
	if !strings.Contains(text(st), `"frame_m1"`) || !strings.Contains(text(st), `"mode": "ask"`) {
		t.Fatalf("status: %s", text(st))
	}
	sess, _ := cs.CallTool(ctx, &mcp.CallToolParams{Name: "create_session", Arguments: map[string]any{}})
	if text(sess) != "sessionId: s-2" {
		t.Fatalf("create_session: %s", text(sess))
	}
	r2, _ := cs.CallTool(ctx, &mcp.CallToolParams{Name: "eval", Arguments: map[string]any{"code": "return 2", "sessionId": "s-2"}})
	if text(r2) != "ran: return 2 in s-2" {
		t.Fatalf("session eval: %s", text(r2))
	}
	bad, _ := cs.CallTool(ctx, &mcp.CallToolParams{Name: "eval", Arguments: map[string]any{"code": "return 3", "sessionId": "invented"}})
	if !bad.IsError || !strings.Contains(text(bad), "E_SESSION") || !strings.Contains(text(bad), "omit sessionId") {
		t.Fatalf("unknown session: %s", text(bad))
	}
}

func TestNoPage(t *testing.T) {
	h, _ := bridge(t)
	cs := mcpClient(t, h)
	r, err := cs.CallTool(context.Background(), &mcp.CallToolParams{Name: "eval", Arguments: map[string]any{"code": "return 1"}})
	if err != nil {
		t.Fatal(err)
	}
	if !r.IsError || !strings.Contains(text(r), "E_NO_PAGE") || !strings.Contains(text(r), "Ask the photographer to open http://127.0.0.1:") {
		t.Fatalf("no page: %s", text(r))
	}
}

func TestTimeoutCancelsOnThePage(t *testing.T) {
	h, url := bridge(t)
	p := connectPage(t, url, true)
	cs := mcpClient(t, h)
	r, _ := cs.CallTool(context.Background(), &mcp.CallToolParams{Name: "eval", Arguments: map[string]any{"code": "for(;;){}", "timeoutMs": 50}})
	if !r.IsError || !strings.Contains(text(r), "E_TIMEOUT") {
		t.Fatalf("timeout: %s", text(r))
	}
	time.Sleep(50 * time.Millisecond)
	ms := p.messages()
	if len(ms) != 2 || ms[1].T != "eval.cancel" || ms[1].Reason != "timeout" || ms[1].ID != ms[0].ID || ms[0].Req.TimeoutMs != 50 {
		t.Fatalf("page saw %+v", ms)
	}
}

func TestClientCancellationReachesThePage(t *testing.T) {
	h, url := bridge(t)
	p := connectPage(t, url, true)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := h.Eval(ctx, hub.EvalCall{Code: "slow()"})
		done <- err
	}()
	time.Sleep(50 * time.Millisecond)
	cancel()
	if err := <-done; err != context.Canceled {
		t.Fatalf("err %v", err)
	}
	time.Sleep(50 * time.Millisecond)
	ms := p.messages()
	if len(ms) != 2 || ms[1].T != "eval.cancel" || ms[1].Reason != "client" {
		t.Fatalf("page saw %+v", ms)
	}
}

func TestPageDisconnectFailsTheCall(t *testing.T) {
	h, url := bridge(t)
	p := connectPage(t, url, true)
	done := make(chan error, 1)
	go func() {
		_, err := h.Eval(context.Background(), hub.EvalCall{Code: "x"})
		done <- err
	}()
	time.Sleep(50 * time.Millisecond)
	_ = p.c.Close(websocket.StatusGoingAway, "tab closed")
	err := <-done
	if he, ok := err.(*hub.Error); !ok || he.Code != "E_NO_PAGE" {
		t.Fatalf("err %v", err)
	}
}

func TestGuards(t *testing.T) {
	_, url := bridge(t)
	get := func(path, host, auth string) int {
		req, _ := http.NewRequest(http.MethodGet, url+path, nil)
		if host != "" {
			req.Host = host
		}
		if auth != "" {
			req.Header.Set("Authorization", auth)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = res.Body.Close()
		return res.StatusCode
	}
	if c := get("/api/health", "", ""); c != http.StatusNoContent {
		t.Fatalf("health %d", c)
	}
	if c := get("/api/health", "evil.example:80", ""); c != http.StatusForbidden {
		t.Fatalf("rebinding host %d", c)
	}
	if c := get("/api/agent/status", "", ""); c != http.StatusUnauthorized {
		t.Fatalf("no token %d", c)
	}
	if c := get("/api/agent/status", "", "Bearer wrong"); c != http.StatusUnauthorized {
		t.Fatalf("wrong token %d", c)
	}
	if c := get("/api/agent/status", "", "Bearer "+token); c != http.StatusOK {
		t.Fatalf("token %d", c)
	}
	// a page from a foreign origin cannot connect
	_, res, err := websocket.Dial(context.Background(), strings.Replace(url, "http://", "ws://", 1)+"/ws/page", &websocket.DialOptions{HTTPHeader: http.Header{"Origin": {"https://evil.example"}}})
	if err == nil || res == nil || res.StatusCode != http.StatusForbidden {
		t.Fatalf("foreign origin: %v %v", err, res)
	}
}

func TestAttachModeForwardsToTheRunningBridge(t *testing.T) {
	_, url := bridge(t)
	connectPage(t, url, false)
	remote := mcpserver.Remote{URL: url, Token: token}
	r, err := remote.Eval(context.Background(), hub.EvalCall{Code: "return 7"})
	if err != nil || r.Text != "ran: return 7 in default" || len(r.Looks) != 1 {
		t.Fatalf("remote eval: %v %+v", err, r)
	}
	st, err := remote.Status(context.Background())
	if err != nil || len(st) != 1 || st[0].ID != "p-1" {
		t.Fatalf("remote status: %v %+v", err, st)
	}
	_, err = mcpserver.Remote{URL: url, Token: "wrong"}.Eval(context.Background(), hub.EvalCall{Code: "x"})
	if err == nil {
		t.Fatal("wrong token accepted")
	}
	js, _ := json.Marshal(r)
	if !strings.Contains(string(js), `"isError":false`) {
		t.Fatalf("json %s", js)
	}
}

type bearerRT struct{ tok string }

func (b bearerRT) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("Authorization", "Bearer "+b.tok)
	return http.DefaultTransport.RoundTrip(r)
}

func TestStreamableHTTPWithBearer(t *testing.T) {
	_, url := bridge(t)
	connectPage(t, url, false)
	ctx := context.Background()
	tr := &mcp.StreamableClientTransport{Endpoint: url + "/mcp", HTTPClient: &http.Client{Transport: bearerRT{token}}, DisableStandaloneSSE: true}
	cs, err := mcp.NewClient(&mcp.Implementation{Name: "http-test", Version: "test"}, nil).Connect(ctx, tr, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer cs.Close()
	r, err := cs.CallTool(ctx, &mcp.CallToolParams{Name: "eval", Arguments: map[string]any{"code": "return 5"}})
	if err != nil || text(r) != "ran: return 5 in default" {
		t.Fatalf("http eval: %v %q", err, text(r))
	}
	// without the token the endpoint refuses
	bad := &mcp.StreamableClientTransport{Endpoint: url + "/mcp", HTTPClient: &http.Client{Transport: bearerRT{"wrong"}}, DisableStandaloneSSE: true, MaxRetries: -1}
	if _, err := mcp.NewClient(&mcp.Implementation{Name: "bad", Version: "test"}, nil).Connect(ctx, bad, nil); err == nil {
		t.Fatal("wrong token accepted")
	}
}
