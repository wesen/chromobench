package mcpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/wesen/chromobench/bridge/internal/hub"
)

// Remote is the attach-mode backend: a `chromobench mcp` started by Claude Desktop or Claude Code forwards to a
// bridge that is already running (`chromobench serve`) with the studio open.
type Remote struct {
	URL    string // http://127.0.0.1:7341
	Token  string
	Client *http.Client
}

type apiError struct {
	Error *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func (r Remote) do(ctx context.Context, method, path string, in, out any) error {
	var body bytes.Buffer
	if in != nil {
		if err := json.NewEncoder(&body).Encode(in); err != nil {
			return err
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, r.URL+path, &body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+r.Token)
	req.Header.Set("Content-Type", "application/json")
	c := r.Client
	if c == nil {
		c = http.DefaultClient
	}
	res, err := c.Do(req)
	if err != nil {
		return &hub.Error{Code: "E_NO_PAGE", Message: "the bridge is not reachable: " + err.Error()}
	}
	defer res.Body.Close()
	var raw json.RawMessage
	if err := json.NewDecoder(res.Body).Decode(&raw); err != nil {
		return fmt.Errorf("bridge answered %s", res.Status)
	}
	var ae apiError
	if json.Unmarshal(raw, &ae) == nil && ae.Error != nil {
		return &hub.Error{Code: ae.Error.Code, Message: ae.Error.Message}
	}
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("bridge answered %s", res.Status)
	}
	return json.Unmarshal(raw, out)
}

func (r Remote) Eval(ctx context.Context, c hub.EvalCall) (hub.Result, error) {
	var out hub.Result
	err := r.do(ctx, http.MethodPost, "/api/agent/eval", c, &out)
	return out, err
}

func (r Remote) CreateSession(ctx context.Context) (string, error) {
	var out struct {
		Session string `json:"sessionId"`
	}
	err := r.do(ctx, http.MethodPost, "/api/agent/session", struct{}{}, &out)
	return out.Session, err
}

func (r Remote) Status(ctx context.Context) ([]hub.PageStatus, error) {
	var out struct {
		Pages []hub.PageStatus `json:"pages"`
	}
	err := r.do(ctx, http.MethodGet, "/api/agent/status", nil, &out)
	return out.Pages, err
}
