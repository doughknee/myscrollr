package platform

import "testing"

// isLoopbackDB decides whether the migration connection may skip TLS. Getting
// it wrong in the permissive direction silently sends the whole DDL chain, and
// the database password, in the clear to a remote host — so the interesting
// cases are the ones that merely LOOK local.
func TestIsLoopbackDB(t *testing.T) {
	cases := []struct {
		name string
		url  string
		want bool
	}{
		// Genuinely local — TLS is not expected and require would just fail.
		{"localhost", "postgres://u:p@localhost:5432/scrollr", true},
		{"127.0.0.1", "postgres://u:p@127.0.0.1:5432/scrollr", true},
		{"ipv6 loopback", "postgres://u:p@[::1]:5432/scrollr", true},
		{"compose service name", "postgres://scrollr:scrollr@postgres:5432/scrollr", true},
		{"docker host alias", "postgres://u:p@host.docker.internal:5432/scrollr", true},

		// Remote — must keep the secure default.
		{"managed postgres", "postgres://u:p@db-do-user-1.k.db.ondigitalocean.com:25060/defaultdb", false},

		// The traps: "localhost" appearing somewhere that is not the host.
		{"localhost as db name", "postgres://u:p@prod.example.com:5432/localhost", false},
		{"localhost in password", "postgres://u:localhost@prod.example.com:5432/scrollr", false},
		{"localhost as username", "postgres://localhost:p@prod.example.com:5432/scrollr", false},
		{"host merely ends with localhost", "postgres://u:p@evil-localhost.example.com:5432/db", false},

		// Unparseable input must not be treated as local.
		{"garbage", "not a url at all", false},
		{"empty", "", false},
	}

	for _, c := range cases {
		if got := isLoopbackDB(c.url); got != c.want {
			t.Errorf("%s: isLoopbackDB = %v, want %v", c.name, got, c.want)
		}
	}
}
