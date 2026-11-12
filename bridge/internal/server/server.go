// Package server assembles the bridge's routes on one net/http ServeMux (Go 1.22 patterns; more specific patterns
// win, so the SPA catch-all cannot shadow the API).
//
//	GET  /{path...}          the studio (a built apps/studio dist directory), index.html for unknown paths
//	GET  /ws/page            the studio page's WebSocket (Origin-checked)
//	POST|GET|DELETE /mcp     MCP Streamable HTTP, stateless (bearer)
//	POST /api/agent/eval     JSON eval for `chromobench mcp` in attach mode (bearer)
//	POST /api/agent/session  create a session (bearer)
//	GET  /api/agent/status   pages, frames, modes (bearer)
//	GET  /api/health         liveness; X-Chromobench-Bridge tells the page it is served by a bridge
package server

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/wesen/chromobench/bridge/internal/guard"
	"github.com/wesen/chromobench/bridge/internal/hub"
	"github.com/wesen/chromobench/bridge/internal/mcpserver"
)

// Options configure the routes.
type Options struct {
	Port int
	// Token is the bearer token for /mcp and /api/agent/*.
	Token string
	// Dir is a built studio (apps/studio/dist); empty serves a short page saying how to build it.
	Dir string
	// Origins are extra page origins allowed on /ws/page (host:port patterns, e.g. "localhost:4173").
	Origins []string
	Version string
	Log     *slog.Logger
}

// Handler builds the bridge's handler around a hub.
func Handler(h *hub.Hub, o Options) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("GET /{path...}", spa(o.Dir))
	mux.Handle("GET /ws/page", h.ServePage(o.Origins, o.Log))
	srv := mcpserver.New(mcpserver.HubBackend{H: h}, mcpserver.Embedded(), o.Version)
	mcpH := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return srv }, &mcp.StreamableHTTPOptions{Stateless: true})
	for _, m := range []string{"POST", "GET", "DELETE"} {
		mux.Handle(m+" /mcp", guard.Bearer(o.Token, mcpH))
	}
	mux.Handle("POST /api/agent/eval", guard.Bearer(o.Token, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var c hub.EvalCall
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&c); err != nil {
			writeErr(w, &hub.Error{Code: "E_TOOL_INPUT", Message: err.Error()})
			return
		}
		res, err := h.Eval(r.Context(), c)
		if err != nil {
			writeErr(w, err)
			return
		}
		writeJSON(w, res)
	})))
	mux.Handle("POST /api/agent/session", guard.Bearer(o.Token, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, err := h.CreateSession(r.Context())
		if err != nil {
			writeErr(w, err)
			return
		}
		writeJSON(w, map[string]string{"sessionId": id})
	})))
	mux.Handle("GET /api/agent/status", guard.Bearer(o.Token, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, map[string]any{"pages": h.Status(), "version": o.Version})
	})))
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("X-Chromobench-Bridge", o.Version)
		w.WriteHeader(http.StatusNoContent)
	})
	return guard.Host(o.Port, mux)
}

// HTTPServer wraps the handler with header timeouts (goja-cv cmd/goja-cv/mcp.go).
func HTTPServer(addr string, h http.Handler) *http.Server {
	return &http.Server{Addr: addr, Handler: h, ReadHeaderTimeout: 5 * time.Second, MaxHeaderBytes: 1 << 20}
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, err error) {
	var he *hub.Error
	if !errors.As(err, &he) {
		he = &hub.Error{Code: "E_INTERNAL", Message: err.Error()}
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK) // the eval failed, the request did not: the agent reads the code
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": he.Code, "message": he.Message}})
}

const noStudio = `<!doctype html><meta charset="utf-8"><title>Chromobench bridge</title>
<p>The bridge is running, but no studio build is attached. Build it with <code>pnpm --filter @chromobench/studio build</code>
and start <code>chromobench serve --dir apps/studio/dist</code>, or open the Vite dev server with
<code>?bridge=ws://127.0.0.1:7341/ws/page</code> and start the bridge with <code>--allow-origin localhost:4173</code>.</p>`

func spa(dir string) http.Handler {
	if dir == "" {
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write([]byte(noStudio))
		})
	}
	fs := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := filepath.Join(dir, filepath.FromSlash(strings.TrimPrefix(filepath.Clean("/"+r.URL.Path), "/")))
		if st, err := os.Stat(p); err != nil || st.IsDir() && r.URL.Path != "/" {
			http.ServeFile(w, r, filepath.Join(dir, "index.html"))
			return
		}
		fs.ServeHTTP(w, r)
	})
}
