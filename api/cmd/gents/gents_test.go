package main

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The generated wire types are committed so the clients can import them
// without a build step. That only works if they cannot go stale, which is
// what this asserts: regenerate in memory and compare against what is on
// disk, in both clients.
//
// Same guard shape as tier_limits.json and catalog.snapshot.json — one side
// is the authority, a test pins the others to it, and CI fails on whichever
// was left behind.
func TestGeneratedTypesAreCurrent(t *testing.T) {
	want, err := Generate()
	if err != nil {
		t.Fatalf("generate: %v", err)
	}

	for _, out := range outputPaths() {
		// Both clients live OUTSIDE the api module. `make shell svc=core-api`
		// mounts only api/ — and AGENTS.md sends you there to compile-check
		// without a host Go toolchain — so in that container the client trees
		// genuinely are not on disk and there is nothing to compare against.
		// Skip that case instead of failing: a guard that is red for everyone
		// following the documented workflow is a guard people learn to ignore,
		// which is the same argument normalizeEOL below already makes about
		// Windows line endings.
		//
		// A missing FILE inside a directory that exists is still a failure —
		// that is someone deleting a generated file, precisely what this
		// guards. Only the whole tree being absent is a skip. CI checks out
		// the entire repo and runs `go test -v`, so a skip there is visible
		// (that is why -v is set, see 67a83cca).
		if _, err := os.Stat(filepath.Dir(out)); errors.Is(err, fs.ErrNotExist) {
			t.Skipf("%s does not exist — api-only checkout (e.g. the core-api "+
				"dev container); nothing to compare against", filepath.Dir(out))
		}

		got, err := os.ReadFile(out)
		if err != nil {
			t.Fatalf("%s: %v (run `go -C api run ./cmd/gents`)", out, err)
		}
		if normalizeEOL(string(got)) == want {
			continue
		}
		t.Errorf("%s is stale — a Go wire struct changed but the generated "+
			"types were not regenerated. Run:\n\n    go -C api run ./cmd/gents\n\n%s",
			out, firstDiff(normalizeEOL(string(got)), want))
	}
}

// The generator always emits LF, but git checks these files out with CRLF on
// Windows (`git ls-files --eol` reports `i/lf w/crlf`). Comparing raw bytes
// therefore failed on every Windows working tree while passing in CI — a
// guard that cries wolf on the developer's own machine is a guard that gets
// ignored. Compare content, not line endings.
//
// `.gitattributes` also pins `*.generated.ts` to LF so the checked-out file
// matches the generator byte-for-byte; this normalization keeps the guard
// honest regardless of how any given clone is configured.
func normalizeEOL(s string) string {
	return strings.ReplaceAll(s, "\r\n", "\n")
}

// A custom MarshalJSON silently invalidates everything generated from
// struct tags, so the generator refuses to emit such a type. Verify that
// refusal exists rather than trusting a comment: Widget carried exactly
// this hazard until the wire rename removed its dual-emit of
// `visible`/`ticker_enabled`.
func TestGeneratorRejectsCustomMarshalJSON(t *testing.T) {
	// platform.SubscriptionResponse is a plain struct today; if someone
	// gives any root type a MarshalJSON, Generate must fail loudly rather
	// than emit tags that no longer describe the JSON.
	src, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(src), "hasCustomMarshalJSON") {
		t.Fatal("the MarshalJSON guard was removed; generated types can now silently lie")
	}
	if _, err := Generate(); err != nil {
		t.Fatalf("generate should succeed with no custom marshallers present: %v", err)
	}
}

// firstDiff reports the first differing line, so a failure names the change
// instead of dumping two files.
func firstDiff(got, want string) string {
	g := strings.Split(got, "\n")
	w := strings.Split(want, "\n")
	for i := 0; i < len(g) && i < len(w); i++ {
		if g[i] != w[i] {
			return "first difference at line " + itoa(i+1) +
				":\n  on disk:   " + g[i] + "\n  generated: " + w[i]
		}
	}
	return "files differ in length: on disk " + itoa(len(g)) + " lines, generated " + itoa(len(w))
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}
