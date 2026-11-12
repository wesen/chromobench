// Package guard holds the bridge's local security (CHB-008 guide §5.5): loopback only, a Host check against DNS
// rebinding, a bearer token for agents (/mcp, /api/agent/*), and the page's Origin check (in hub.ServePage).
package guard

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Config is bridge.json: where a running bridge listens and the token agents present.
type Config struct {
	Port  int    `json:"port"`
	Token string `json:"token"`
}

// Path is $XDG_CONFIG_HOME/chromobench/bridge.json (or ~/.config/…).
func Path() (string, error) {
	dir := os.Getenv("XDG_CONFIG_HOME")
	if dir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		dir = filepath.Join(home, ".config")
	}
	return filepath.Join(dir, "chromobench", "bridge.json"), nil
}

// Load reads bridge.json.
func Load(path string) (Config, error) {
	var c Config
	b, err := os.ReadFile(path)
	if err != nil {
		return c, err
	}
	err = json.Unmarshal(b, &c)
	return c, err
}

// LoadOrCreate reads bridge.json, creating a token on first use; the port is updated to `port` and the file
// written with mode 0600.
func LoadOrCreate(path string, port int) (Config, error) {
	c, err := Load(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return c, err
	}
	if c.Token == "" {
		b := make([]byte, 32)
		if _, err := rand.Read(b); err != nil {
			return c, err
		}
		c.Token = hex.EncodeToString(b)
	}
	c.Port = port
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return c, err
	}
	js, _ := json.MarshalIndent(c, "", "  ")
	return c, os.WriteFile(path, js, 0o600)
}

// Loopback refuses non-loopback listen addresses (unlike goja-cv's --allow-remote, there is no override in v0).
func Loopback(addr string) (port int, err error) {
	host, p, err := net.SplitHostPort(addr)
	if err != nil {
		return 0, err
	}
	ip := net.ParseIP(host)
	if host != "localhost" && (ip == nil || !ip.IsLoopback()) {
		return 0, fmt.Errorf("refusing to listen on %s: the bridge listens on loopback only (127.0.0.1)", addr)
	}
	return strconv.Atoi(p)
}

// Host rejects requests whose Host header is not this bridge on loopback (DNS rebinding).
func Host(port int, next http.Handler) http.Handler {
	ok := map[string]bool{}
	for _, h := range []string{"127.0.0.1", "localhost", "[::1]"} {
		ok[fmt.Sprintf("%s:%d", h, port)] = true
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !ok[strings.ToLower(r.Host)] {
			http.Error(w, "forbidden host", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Bearer requires Authorization: Bearer <token>.
func Bearer(token string, next http.Handler) http.Handler {
	want := []byte("Bearer " + token)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got := []byte(r.Header.Get("Authorization"))
		if token == "" || subtle.ConstantTimeCompare(got, want) != 1 {
			w.Header().Set("WWW-Authenticate", "Bearer")
			http.Error(w, "missing or wrong bearer token (chromobench token prints it)", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}
