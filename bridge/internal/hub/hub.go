// Package hub relays evals between external agents (MCP) and studio pages (CHB-008 guide §5.4–5.5).
//
// A page connects over a WebSocket and says hello; the hub routes each eval to the page that owns its session, or
// to the most recently focused page, correlates the answer by id, enforces a watchdog of deadline + 5 s, and tells
// the page to cancel when the caller goes away. The hub never sees recipes: only code, result text and looks.
package hub

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"sync"
	"time"
)

// DefaultTimeout and MaxTimeout bound an eval's deadline (guide §5.2).
const (
	DefaultTimeout = 30 * time.Second
	MaxTimeout     = 120 * time.Second
	// DefaultGrace is how long past an eval's deadline the hub waits for the page before it cancels the eval.
	DefaultGrace = 5 * time.Second
)

// Look is one picture an eval returned, base64 as the page sends it.
type Look struct {
	N       int    `json:"n"`
	Caption string `json:"caption"`
	MIME    string `json:"mime"`
	Base64  string `json:"base64"`
}

// Result is a rendered eval result.
type Result struct {
	Text    string `json:"text"`
	IsError bool   `json:"isError"`
	Looks   []Look `json:"looks"`
}

// EvalCall is what a transport asks for.
type EvalCall struct {
	Session   string `json:"sessionId,omitempty"`
	Frame     string `json:"frame,omitempty"`
	Code      string `json:"code"`
	TimeoutMs int    `json:"timeoutMs,omitempty"`
}

// FrameSummary is one open frame of a page.
type FrameSummary struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Open bool   `json:"open"`
}

// PageMsg is every message a page sends (discriminated by T).
type PageMsg struct {
	T           string         `json:"t"`
	ID          string         `json:"id,omitempty"`
	Page        string         `json:"page,omitempty"`
	App         string         `json:"app,omitempty"`
	CatalogHash string         `json:"catalogHash,omitempty"`
	Focused     *bool          `json:"focused,omitempty"`
	Frame       string         `json:"frame,omitempty"`
	Frames      []FrameSummary `json:"frames,omitempty"`
	Mode        string         `json:"mode,omitempty"`
	Text        string         `json:"text,omitempty"`
	IsError     bool           `json:"isError,omitempty"`
	Looks       []Look         `json:"looks,omitempty"`
	Session     string         `json:"session,omitempty"`
	Error       string         `json:"error,omitempty"`
}

// EvalReq is the eval request the page runs.
type EvalReq struct {
	Code      string `json:"code"`
	Frame     string `json:"frame,omitempty"`
	TimeoutMs int    `json:"timeoutMs"`
}

// BridgeMsg is every message the hub sends to a page.
type BridgeMsg struct {
	T       string   `json:"t"`
	ID      string   `json:"id,omitempty"`
	Session string   `json:"session,omitempty"`
	Req     *EvalReq `json:"req,omitempty"`
	Reason  string   `json:"reason,omitempty"`
}

// Conn is one page connection (a WebSocket, or a fake in tests).
type Conn interface {
	Send(ctx context.Context, m BridgeMsg) error
	Close(reason string)
}

// PageStatus is what the status tool reports about a page.
type PageStatus struct {
	ID          string         `json:"id"`
	App         string         `json:"app"`
	CatalogHash string         `json:"catalogHash,omitempty"`
	Focused     bool           `json:"focused"`
	Frame       string         `json:"frame,omitempty"`
	Mode        string         `json:"mode,omitempty"`
	Frames      []FrameSummary `json:"frames"`
	Sessions    []string       `json:"sessions"`
}

// Error is a hub failure the agent can act on (code + a sentence).
type Error struct {
	Code    string
	Message string
}

func (e *Error) Error() string { return e.Code + ": " + e.Message }

// ErrNoPage is returned when no studio page is connected.
func ErrNoPage(url string) *Error {
	return &Error{Code: "E_NO_PAGE", Message: fmt.Sprintf("Chromobench is not open. Ask the photographer to open %s.", url)}
}

type page struct {
	id       string
	conn     Conn
	app      string
	hash     string
	focused  bool
	frame    string
	mode     string
	frames   []FrameSummary
	lastSeen time.Time
	closed   chan struct{}
}

type call struct {
	page *page
	done chan PageMsg
}

// Hub is safe for concurrent use.
type Hub struct {
	// URL is where the studio is served (for the E_NO_PAGE sentence).
	URL string
	// Grace is added to an eval's deadline for the watchdog (DefaultGrace).
	Grace time.Duration

	mu       sync.Mutex
	pages    map[string]*page
	sessions map[string]*page // session id → owning page
	calls    map[string]*call
	seq      int
	now      func() time.Time
}

// New makes an empty hub.
func New(url string) *Hub {
	return &Hub{URL: url, Grace: DefaultGrace, pages: map[string]*page{}, sessions: map[string]*page{}, calls: map[string]*call{}, now: time.Now}
}

// Attach registers a page after its hello; the returned function handles its later messages, and the closer
// must be called when the connection ends.
func (h *Hub) Attach(conn Conn, hello PageMsg) (receive func(PageMsg), closer func()) {
	p := &page{id: hello.Page, conn: conn, app: hello.App, hash: hello.CatalogHash, frames: hello.Frames, mode: hello.Mode, frame: hello.Frame, lastSeen: h.now(), closed: make(chan struct{})}
	if hello.Focused != nil {
		p.focused = *hello.Focused
	}
	h.mu.Lock()
	if old := h.pages[p.id]; old != nil {
		h.dropLocked(old, "replaced by a new connection")
	}
	h.pages[p.id] = p
	h.mu.Unlock()
	return func(m PageMsg) { h.receive(p, m) }, func() { h.drop(p, "the page disconnected") }
}

func (h *Hub) receive(p *page, m PageMsg) {
	h.mu.Lock()
	defer h.mu.Unlock()
	switch m.T {
	case "focus":
		if m.Focused != nil {
			p.focused = *m.Focused
		}
		if m.Frame != "" {
			p.frame = m.Frame
		}
		if m.Frames != nil {
			p.frames = m.Frames
		}
		if m.Mode != "" {
			p.mode = m.Mode
		}
		p.lastSeen = h.now()
	case "eval.result", "session.created", "session.error":
		if c := h.calls[m.ID]; c != nil && c.page == p {
			delete(h.calls, m.ID)
			if m.T == "session.created" && m.Session != "" {
				h.sessions[m.Session] = p
			}
			c.done <- m
		}
	}
}

func (h *Hub) drop(p *page, why string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.dropLocked(p, why)
}

func (h *Hub) dropLocked(p *page, why string) {
	if h.pages[p.id] != p {
		return
	}
	delete(h.pages, p.id)
	for s, owner := range h.sessions {
		if owner == p {
			delete(h.sessions, s)
		}
	}
	close(p.closed)
	go p.conn.Close(why) // a close handshake must not hold the hub's lock
}

// pick returns the page for a session, or the most recently focused page.
func (h *Hub) pick(session string) (*page, *Error) {
	if session != "" && session != "default" {
		if p := h.sessions[session]; p != nil {
			return p, nil
		}
		ids := make([]string, 0, len(h.sessions))
		for s := range h.sessions {
			ids = append(ids, s)
		}
		sort.Strings(ids)
		msg := fmt.Sprintf("unknown session %q; omit sessionId to use the default session", session)
		if len(ids) > 0 {
			msg += fmt.Sprintf(" (sessions: %v)", ids)
		}
		return nil, &Error{Code: "E_SESSION", Message: msg}
	}
	var best *page
	for _, p := range h.pages {
		if best == nil || (p.focused && !best.focused) || (p.focused == best.focused && p.lastSeen.After(best.lastSeen)) {
			best = p
		}
	}
	if best == nil {
		return nil, ErrNoPage(h.URL)
	}
	return best, nil
}

func (h *Hub) nextID() string {
	h.seq++
	return fmt.Sprintf("e-%04d", h.seq)
}

// Eval runs one eval on a page and waits for its result, the watchdog, the caller's cancellation or the page's
// disconnection. Hub failures come back as *Error.
func (h *Hub) Eval(ctx context.Context, c EvalCall) (Result, error) {
	if c.Code == "" {
		return Result{}, &Error{Code: "E_TOOL_INPUT", Message: "code is empty: send the body of an async function that ends with return"}
	}
	timeout := DefaultTimeout
	if c.TimeoutMs > 0 {
		timeout = time.Duration(c.TimeoutMs) * time.Millisecond
	}
	if timeout > MaxTimeout {
		timeout = MaxTimeout
	}
	session := c.Session
	if session == "" {
		session = "default"
	}
	h.mu.Lock()
	p, herr := h.pick(session)
	if herr != nil {
		h.mu.Unlock()
		return Result{}, herr
	}
	id := h.nextID()
	cl := &call{page: p, done: make(chan PageMsg, 1)}
	h.calls[id] = cl
	h.mu.Unlock()
	cleanup := func() {
		h.mu.Lock()
		delete(h.calls, id)
		h.mu.Unlock()
	}
	msg := BridgeMsg{T: "eval", ID: id, Session: session, Req: &EvalReq{Code: c.Code, Frame: c.Frame, TimeoutMs: int(timeout / time.Millisecond)}}
	if err := p.conn.Send(ctx, msg); err != nil {
		cleanup()
		return Result{}, &Error{Code: "E_NO_PAGE", Message: "the page connection failed: " + err.Error()}
	}
	timer := time.NewTimer(timeout + h.Grace)
	defer timer.Stop()
	select {
	case m := <-cl.done:
		return Result{Text: m.Text, IsError: m.IsError, Looks: m.Looks}, nil
	case <-ctx.Done():
		cleanup()
		_ = p.conn.Send(context.Background(), BridgeMsg{T: "eval.cancel", ID: id, Reason: "client"})
		return Result{}, ctx.Err()
	case <-timer.C:
		cleanup()
		_ = p.conn.Send(context.Background(), BridgeMsg{T: "eval.cancel", ID: id, Reason: "timeout"})
		return Result{}, &Error{Code: "E_TIMEOUT", Message: fmt.Sprintf("the page did not answer within %s; the eval was cancelled", timeout+h.Grace)}
	case <-p.closed:
		cleanup()
		return Result{}, &Error{Code: "E_NO_PAGE", Message: "the page disconnected during the eval; its staged changes were discarded"}
	}
}

// CreateSession asks the focused page for a fresh session (an empty mem); returns its id.
func (h *Hub) CreateSession(ctx context.Context) (string, error) {
	h.mu.Lock()
	p, herr := h.pick("")
	if herr != nil {
		h.mu.Unlock()
		return "", herr
	}
	id := h.nextID()
	cl := &call{page: p, done: make(chan PageMsg, 1)}
	h.calls[id] = cl
	h.mu.Unlock()
	if err := p.conn.Send(ctx, BridgeMsg{T: "session.create", ID: id}); err != nil {
		return "", &Error{Code: "E_NO_PAGE", Message: err.Error()}
	}
	select {
	case m := <-cl.done:
		if m.Error != "" || m.Session == "" {
			return "", &Error{Code: "E_SESSION", Message: "the page could not create a session: " + m.Error}
		}
		return m.Session, nil
	case <-ctx.Done():
		return "", ctx.Err()
	case <-time.After(10 * time.Second):
		return "", &Error{Code: "E_TIMEOUT", Message: "the page did not create a session"}
	case <-p.closed:
		return "", &Error{Code: "E_NO_PAGE", Message: "the page disconnected"}
	}
}

// Status lists the connected pages.
func (h *Hub) Status() []PageStatus {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := []PageStatus{}
	for _, p := range h.pages {
		s := PageStatus{ID: p.id, App: p.app, CatalogHash: p.hash, Focused: p.focused, Frame: p.frame, Mode: p.mode, Frames: p.frames, Sessions: []string{"default"}}
		for id, owner := range h.sessions {
			if owner == p {
				s.Sessions = append(s.Sessions, id)
			}
		}
		if s.Frames == nil {
			s.Frames = []FrameSummary{}
		}
		sort.Strings(s.Sessions[1:])
		out = append(out, s)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// DecodeHello parses a page's first message.
func DecodeHello(b []byte) (PageMsg, error) {
	var m PageMsg
	if err := json.Unmarshal(b, &m); err != nil {
		return m, err
	}
	if m.T != "hello" || m.Page == "" {
		return m, errors.New("the first message must be {t:'hello', page}")
	}
	return m, nil
}
