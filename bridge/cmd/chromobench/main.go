// chromobench: the local bridge between the studio page and external agents (CHB-008 guide §5.5).
//
//	chromobench serve [--addr 127.0.0.1:7341] [--dir apps/studio/dist] [--allow-origin localhost:4173]
//	chromobench mcp   [--addr 127.0.0.1:7341] [--dir …]     MCP on stdio: attaches to a running bridge, or starts one
//	chromobench token                                       prints the bearer token for Claude Code's HTTP transport
//
// Claude Code:    claude mcp add chromobench -- chromobench mcp
//
//	claude mcp add --transport http chromobench http://127.0.0.1:7341/mcp --header "Authorization: Bearer $(chromobench token)"
//
// Claude Desktop: {"mcpServers": {"chromobench": {"command": "/path/to/chromobench", "args": ["mcp"]}}}
//
// A stdio server owns stdout for the protocol: everything else is logged to stderr.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/wesen/chromobench/bridge/internal/guard"
	"github.com/wesen/chromobench/bridge/internal/hub"
	"github.com/wesen/chromobench/bridge/internal/mcpserver"
	"github.com/wesen/chromobench/bridge/internal/server"
)

const version = "0.1.0"

func main() {
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	var err error
	switch os.Args[1] {
	case "serve":
		err = serve(ctx, os.Args[2:], log)
	case "mcp":
		err = mcpStdio(ctx, os.Args[2:], log)
	case "token":
		err = token(os.Args[2:])
	default:
		usage()
		os.Exit(2)
	}
	if err != nil && !errors.Is(err, context.Canceled) {
		fmt.Fprintln(os.Stderr, "chromobench:", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: chromobench serve|mcp|token [flags]")
}

type serveFlags struct {
	addr    string
	dir     string
	origins string
	config  string
}

// configPath is --config, or $XDG_CONFIG_HOME/chromobench/bridge.json.
func (f serveFlags) configPath() (string, error) {
	if f.config != "" {
		return f.config, nil
	}
	return guard.Path()
}

func parse(name string, args []string) (serveFlags, error) {
	var f serveFlags
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	fs.StringVar(&f.addr, "addr", "127.0.0.1:7341", "listen address (loopback only)")
	fs.StringVar(&f.dir, "dir", "", "a built studio (apps/studio/dist) to serve")
	fs.StringVar(&f.config, "config", "", "bridge.json path (default $XDG_CONFIG_HOME/chromobench/bridge.json)")
	fs.StringVar(&f.origins, "allow-origin", "", "extra page origins for /ws/page, comma-separated host:port (e.g. localhost:4173 for the Vite dev server)")
	return f, fs.Parse(args)
}

// start runs the full bridge (hub, studio, MCP over HTTP) in the background and writes bridge.json.
func start(ctx context.Context, f serveFlags, log *slog.Logger) (*hub.Hub, *http.Server, error) {
	port, err := guard.Loopback(f.addr)
	if err != nil {
		return nil, nil, err
	}
	path, err := f.configPath()
	if err != nil {
		return nil, nil, err
	}
	cfg, err := guard.LoadOrCreate(path, port)
	if err != nil {
		return nil, nil, err
	}
	h := hub.New(fmt.Sprintf("http://127.0.0.1:%d", port))
	var origins []string
	for _, o := range strings.Split(f.origins, ",") {
		if o = strings.TrimSpace(o); o != "" {
			origins = append(origins, o)
		}
	}
	srv := server.HTTPServer(f.addr, server.Handler(h, server.Options{Port: port, Token: cfg.Token, Dir: f.dir, Origins: origins, Version: version, Log: log}))
	go func() {
		<-ctx.Done()
		sctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = srv.Shutdown(sctx)
	}()
	log.Info("chromobench bridge", "url", h.URL, "config", path)
	return h, srv, nil
}

func serve(ctx context.Context, args []string, log *slog.Logger) error {
	f, err := parse("serve", args)
	if err != nil {
		return err
	}
	_, srv, err := start(ctx, f, log)
	if err != nil {
		return err
	}
	if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func mcpStdio(ctx context.Context, args []string, log *slog.Logger) error {
	f, err := parse("mcp", args)
	if err != nil {
		return err
	}
	var backend mcpserver.Backend
	if path, err := f.configPath(); err == nil {
		if cfg, err := guard.Load(path); err == nil && cfg.Port > 0 && healthy(cfg.Port) {
			log.Info("attaching to the running bridge", "port", cfg.Port)
			backend = mcpserver.Remote{URL: fmt.Sprintf("http://127.0.0.1:%d", cfg.Port), Token: cfg.Token}
		}
	}
	if backend == nil {
		h, srv, err := start(ctx, f, log)
		if err != nil {
			return err
		}
		go func() {
			if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				log.Error("bridge stopped", "err", err)
			}
		}()
		backend = mcpserver.HubBackend{H: h}
	}
	srv := mcpserver.New(backend, mcpserver.Embedded(), version)
	return srv.Run(ctx, &mcp.StdioTransport{})
}

func healthy(port int) bool {
	c := http.Client{Timeout: 700 * time.Millisecond}
	res, err := c.Get(fmt.Sprintf("http://127.0.0.1:%d/api/health", port))
	if err != nil {
		return false
	}
	_ = res.Body.Close()
	return res.Header.Get("X-Chromobench-Bridge") != ""
}

func token(args []string) error {
	f, err := parse("token", args)
	if err != nil {
		return err
	}
	path, err := f.configPath()
	if err != nil {
		return err
	}
	cfg, err := guard.Load(path)
	if err != nil {
		return fmt.Errorf("no bridge.json yet (%s): run chromobench serve once", path)
	}
	fmt.Println(cfg.Token)
	return nil
}
