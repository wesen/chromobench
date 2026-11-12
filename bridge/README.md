# chromobench bridge

A local Go binary that lets external agents (Claude Code, Claude Desktop) work in the photographer's open studio
through MCP (CHB-008). The agent gets one `eval` tool whose input is DSL code; the bridge relays it over a WebSocket
to the studio page, which runs it in a sandboxed DSL session (QuickJS in a Web Worker) and answers with the result
text and looks. Agent edits are proposals in the frame's EditLog; in ask mode the photographer approves them in the
studio. The bridge never sees recipes.

## Build and run

```sh
cd bridge && go build -o chromobench ./cmd/chromobench
pnpm --filter @chromobench/studio build
./chromobench serve --dir ../apps/studio/dist          # open http://127.0.0.1:7341
```

The studio connects by itself when the bridge serves it (status bar: "agents: connected"). With the Vite dev server
instead: `./chromobench serve --allow-origin localhost:4173` and open `http://localhost:4173/?bridge=ws://127.0.0.1:7341/ws/page`.

## Connect an agent

```sh
# Claude Code, stdio (attaches to a running bridge, or starts one)
claude mcp add chromobench -- /path/to/chromobench mcp
# Claude Code, HTTP
claude mcp add --transport http chromobench http://127.0.0.1:7341/mcp --header "Authorization: Bearer $(chromobench token)"
```

Claude Desktop (`claude_desktop_config.json`): `{"mcpServers": {"chromobench": {"command": "/path/to/chromobench", "args": ["mcp"]}}}`.
Set `MCP_TOOL_TIMEOUT` above 120 s in Claude Code for long evals.

## Security

Loopback only; the `Host` header must name the bridge (DNS rebinding); `/mcp` and `/api/agent/*` need the bearer
token stored with the port in `$XDG_CONFIG_HOME/chromobench/bridge.json` (mode 0600, `--config` overrides);
`/ws/page` accepts only the bridge's own origin plus `--allow-origin` entries.

## Not yet

- `go:embed` of the built studio (serve `--dir` for now), the page cookie on `/ws/page`, and the Claude API proxy
  (`/api/claude/…`): the in-app chat calls the API directly with a key the photographer types.
- Go tests run with `go test ./...` in this directory; they are not part of `pnpm test`.
