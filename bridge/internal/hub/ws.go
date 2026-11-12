package hub

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

type wsConn struct {
	c  *websocket.Conn
	mu sync.Mutex
}

func (w *wsConn) Send(ctx context.Context, m BridgeMsg) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return wsjson.Write(ctx, w.c, m)
}

func (w *wsConn) Close(reason string) {
	_ = w.c.Close(websocket.StatusNormalClosure, reason)
}

// ServePage upgrades /ws/page and runs one page connection until it closes. originPatterns are the extra page
// origins accepted besides the bridge's own (e.g. "localhost:4173" for the Vite dev server).
func (h *Hub) ServePage(originPatterns []string, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: originPatterns})
		if err != nil {
			return // Accept wrote the error (e.g. 403 for a foreign Origin)
		}
		c.SetReadLimit(64 << 20) // looks travel base64 in the JSON: at most 8 MiB per eval, with headroom
		ctx := r.Context()
		_, first, err := c.Read(ctx)
		if err != nil {
			return
		}
		hello, err := DecodeHello(first)
		if err != nil {
			_ = c.Close(websocket.StatusPolicyViolation, err.Error())
			return
		}
		conn := &wsConn{c: c}
		receive, closer := h.Attach(conn, hello)
		defer closer()
		if log != nil {
			log.Info("page connected", "page", hello.Page, "app", hello.App)
		}
		for {
			_, b, err := c.Read(ctx)
			if err != nil {
				if log != nil {
					log.Info("page disconnected", "page", hello.Page, "err", err)
				}
				return
			}
			var m PageMsg
			if json.Unmarshal(b, &m) == nil {
				receive(m)
			}
		}
	}
}
