// Command gents generates the TypeScript wire types both clients import,
// directly from the Go structs that produce the JSON (VISION §4.6).
//
// Why not OpenAPI, which ROLLOUT names: there is no OpenAPI spec. The api
// module has a swaggo header on main() and zero handler annotations, so
// producing one would mean adding the dependency and annotating ~50
// handlers to describe shapes the Go structs already define exactly. The
// decision's stated purpose is "TS types generated from the Go contract so
// web and desktop cannot drift on the wire shape... no monorepo tooling
// required" — this reads the same source of truth and delivers that with a
// Go program, no new dependency, and no intermediate document to keep
// current. Revisit if something other than the two TS clients ever needs
// the contract.
//
// Usage:
//
//	go run ./cmd/gents          # write the generated files
//	go run ./cmd/gents -check   # exit non-zero if they are stale
//
// The drift guard in gents_test.go runs the -check path in CI.
package main

import (
	"bytes"
	"flag"
	"fmt"
	"go/types"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"golang.org/x/tools/go/packages"
)

const modPath = "github.com/brandon-relentnet/myscrollr/api"

// roots are the types the clients actually consume. Deliberately explicit:
// generating every struct with a json tag would drag in the Discord,
// OSTicket and GitHub webhook payloads, which are server-to-third-party
// shapes no client ever sees.
var roots = []struct{ pkg, name string }{
	{"internal/platform", "ErrorResponse"},
	{"internal/platform", "HealthResponse"},
	{"internal/platform", "Widget"},
	{"internal/platform", "DashboardResponse"},
	{"internal/platform", "UserPreferences"},
	{"internal/platform", "SubscriptionResponse"},
	{"internal/platform", "CheckoutResponse"},
	{"internal/platform", "SetupIntentResponse"},
	{"internal/platform", "PaymentIntentResponse"},
	{"internal/platform", "PlanPreviewResponse"},
	{"internal/platform", "SubscribeResponse"},
	{"internal/platform", "CheckoutReturnResponse"},
	{"internal/platform", "WidgetDef"},
	{"internal/widgets", "CatalogResponse"},
	{"internal/widgets", "TierLimitsResponse"},
	{"internal/widgets", "WidgetLimits"},
	{"internal/accounts", "OverviewResponse"},
}

// outputs receive identical content. Two copies rather than one shared file
// because the clients are separate npm projects with no workspace tooling
// (a constraint VISION §4.6 states outright), and a cross-project relative
// import would fight Vite's filesystem allow-list. The drift guard covers
// both, so they cannot disagree.
//
// Resolved from the repo root, not the working directory, so `go run` from
// api/ and `go test ./cmd/gents` from the package dir both land in the same
// place.
func outputPaths() []string {
	root := repoRoot()
	return []string{
		filepath.Join(root, "desktop", "src", "types", "api.generated.ts"),
		filepath.Join(root, "myscrollr.com", "src", "types", "api.generated.ts"),
	}
}

// repoRoot walks up to the directory holding the api module, then one more
// to the repo root that contains both clients.
func repoRoot() string {
	dir, err := os.Getwd()
	if err != nil {
		panic(err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return filepath.Dir(dir) // api/ -> repo root
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			panic("no go.mod above " + dir)
		}
		dir = parent
	}
}

func main() {
	check := flag.Bool("check", false, "verify the committed files are current instead of writing them")
	flag.Parse()

	got, err := Generate()
	if err != nil {
		fmt.Fprintln(os.Stderr, "generate:", err)
		os.Exit(1)
	}

	for _, out := range outputPaths() {
		if *check {
			existing, err := os.ReadFile(out)
			if err != nil {
				fmt.Fprintf(os.Stderr, "%s: %v\n", out, err)
				os.Exit(1)
			}
			if string(existing) != got {
				fmt.Fprintf(os.Stderr, "%s is stale — run `go run ./cmd/gents`\n", out)
				os.Exit(1)
			}
			continue
		}
		if err := os.WriteFile(out, []byte(got), 0o644); err != nil {
			fmt.Fprintf(os.Stderr, "%s: %v\n", out, err)
			os.Exit(1)
		}
		fmt.Println("wrote", out)
	}
}

// Generate loads the api module and renders the TypeScript source.
func Generate() (string, error) {
	patterns := map[string]bool{}
	for _, r := range roots {
		patterns[modPath+"/"+r.pkg] = true
	}
	var list []string
	for p := range patterns {
		list = append(list, p)
	}
	sort.Strings(list)

	pkgs, err := packages.Load(&packages.Config{
		Mode: packages.NeedName | packages.NeedTypes | packages.NeedTypesInfo | packages.NeedDeps | packages.NeedImports,
	}, list...)
	if err != nil {
		return "", err
	}
	byPath := map[string]*packages.Package{}
	for _, p := range pkgs {
		if len(p.Errors) > 0 {
			return "", fmt.Errorf("%s: %v", p.PkgPath, p.Errors[0])
		}
		byPath[p.PkgPath] = p
	}

	g := &generator{emitted: map[string]bool{}, out: map[string]string{}}
	for _, r := range roots {
		p := byPath[modPath+"/"+r.pkg]
		if p == nil {
			return "", fmt.Errorf("package not loaded: %s", r.pkg)
		}
		obj := p.Types.Scope().Lookup(r.name)
		if obj == nil {
			return "", fmt.Errorf("%s.%s not found", r.pkg, r.name)
		}
		named, ok := obj.Type().(*types.Named)
		if !ok {
			return "", fmt.Errorf("%s.%s is not a named type", r.pkg, r.name)
		}
		if err := g.emit(named); err != nil {
			return "", err
		}
	}

	names := make([]string, 0, len(g.out))
	for n := range g.out {
		names = append(names, n)
	}
	sort.Strings(names)

	var b bytes.Buffer
	b.WriteString(header)
	for _, n := range names {
		b.WriteString(g.out[n])
	}
	return b.String(), nil
}

const header = `// Code generated by api/cmd/gents. DO NOT EDIT.
//
// The wire contract, generated from the Go structs that serialize it, so
// the desktop and the website cannot drift from the server or each other
// (VISION §4.6). The server is the authority; these are a projection of it.
//
// Transport stays per-platform on purpose — the desktop goes through the
// Tauri HTTP plugin and the website through browser fetch, which are
// genuinely different. Only the shapes are shared.
//
// To change one of these, change the Go struct and run:
//
//     go -C api run ./cmd/gents
//
// A test fails the build if this file is stale.

`

type generator struct {
	emitted map[string]bool
	out     map[string]string
}

// emit renders a named struct type and anything it references.
func (g *generator) emit(named *types.Named) error {
	name := named.Obj().Name()
	if g.emitted[name] {
		return nil
	}
	g.emitted[name] = true

	// A custom MarshalJSON means the struct tags are NOT the whole truth,
	// and anything generated from them would be quietly wrong. (Widget had
	// exactly this until the wire rename deleted its dual-emit.) Refuse
	// rather than emit a lie.
	if hasCustomMarshalJSON(named) {
		return fmt.Errorf(
			"%s implements MarshalJSON, so its struct tags do not describe its JSON. "+
				"Either drop the custom marshaller or hand-write this type", name)
	}

	st, ok := named.Underlying().(*types.Struct)
	if !ok {
		return fmt.Errorf("%s is not a struct", name)
	}

	var b strings.Builder
	fmt.Fprintf(&b, "export interface %s {\n", name)
	for i := 0; i < st.NumFields(); i++ {
		f := st.Field(i)
		jsonName, omitempty, skip := parseJSONTag(st.Tag(i), f.Name())
		if skip || !f.Exported() {
			continue
		}
		tsType, nullable, err := g.tsType(f.Type())
		if err != nil {
			return fmt.Errorf("%s.%s: %w", name, f.Name(), err)
		}
		// `nullable` means the Go field is a pointer. Pointers and omitempty
		// pull in OPPOSITE directions and this used to conflate them, emitting
		// `field?: T` for both:
		//
		//   *T with omitempty     nil is omitted entirely  ->  field?: T
		//   *T without omitempty  nil is written as null   ->  field: T | null
		//
		// The second case was the lie: the key is always present, so `?` told
		// consumers it might be missing while nothing warned them it could be
		// null. `max_widgets`, `subscription`, `fantasy`, `requested_at` and
		// `purge_at` all serialize null on a free/unlinked account.
		q := ""
		switch {
		case omitempty:
			q = "?"
		case nullable:
			tsType += " | null"
		}
		fmt.Fprintf(&b, "  %s%s: %s;\n", jsonName, q, tsType)
	}
	b.WriteString("}\n\n")
	g.out[name] = b.String()
	return nil
}

// tsType maps a Go type to TypeScript, reporting whether it is nullable
// (a pointer), and queues any named struct it references.
func (g *generator) tsType(t types.Type) (string, bool, error) {
	switch v := t.(type) {
	case *types.Pointer:
		inner, _, err := g.tsType(v.Elem())
		return inner, true, err

	case *types.Basic:
		switch {
		case v.Info()&types.IsBoolean != 0:
			return "boolean", false, nil
		case v.Info()&types.IsNumeric != 0:
			return "number", false, nil
		case v.Info()&types.IsString != 0:
			return "string", false, nil
		}
		return "unknown", false, nil

	case *types.Named:
		// time.Time serializes as an RFC3339 string.
		if v.Obj().Pkg() != nil && v.Obj().Pkg().Path() == "time" && v.Obj().Name() == "Time" {
			return "string", false, nil
		}
		if _, ok := v.Underlying().(*types.Struct); ok {
			if err := g.emit(v); err != nil {
				return "", false, err
			}
			return v.Obj().Name(), false, nil
		}
		// A defined string type with declared constants becomes a union, so the
		// clients get the same exhaustiveness the Go side has instead of a
		// bare `string`.
		if u, ok := v.Underlying().(*types.Basic); ok && u.Info()&types.IsString != 0 {
			if union := constUnion(v); union != "" {
				return union, false, nil
			}
		}
		return g.tsType(v.Underlying())

	case *types.Slice:
		if b, ok := v.Elem().(*types.Basic); ok && b.Kind() == types.Uint8 {
			return "string", false, nil // []byte is base64 JSON
		}
		inner, _, err := g.tsType(v.Elem())
		if err != nil {
			return "", false, err
		}
		return inner + "[]", false, nil

	case *types.Map:
		k, _, err := g.tsType(v.Key())
		if err != nil {
			return "", false, err
		}
		val, _, err := g.tsType(v.Elem())
		if err != nil {
			return "", false, err
		}
		return fmt.Sprintf("Record<%s, %s>", k, val), false, nil

	case *types.Interface:
		return "unknown", false, nil
	}
	return "unknown", false, nil
}

// constUnion renders the declared constants of a named string type as a
// TypeScript union, or "" when the type has none.
func constUnion(named *types.Named) string {
	pkg := named.Obj().Pkg()
	if pkg == nil {
		return ""
	}
	var vals []string
	scope := pkg.Scope()
	for _, name := range scope.Names() {
		c, ok := scope.Lookup(name).(*types.Const)
		if !ok {
			continue
		}
		if ct, ok := c.Type().(*types.Named); !ok || ct.Obj() != named.Obj() {
			continue
		}
		vals = append(vals, c.Val().String()) // already quoted
	}
	if len(vals) == 0 {
		return ""
	}
	sort.Strings(vals)
	return strings.Join(vals, " | ")
}

// hasCustomMarshalJSON reports whether the type (or its pointer) defines
// MarshalJSON.
func hasCustomMarshalJSON(named *types.Named) bool {
	for _, t := range []types.Type{named, types.NewPointer(named)} {
		ms := types.NewMethodSet(t)
		for i := 0; i < ms.Len(); i++ {
			if ms.At(i).Obj().Name() == "MarshalJSON" {
				return true
			}
		}
	}
	return false
}

// parseJSONTag returns the wire name, whether the field is omitempty, and
// whether it is skipped entirely.
func parseJSONTag(tag, fieldName string) (name string, omitempty, skip bool) {
	raw := reflectTagLookup(tag, "json")
	if raw == "-" {
		return "", false, true
	}
	if raw == "" {
		return fieldName, false, false
	}
	parts := strings.Split(raw, ",")
	name = parts[0]
	if name == "" {
		name = fieldName
	}
	for _, p := range parts[1:] {
		if p == "omitempty" {
			omitempty = true
		}
	}
	return name, omitempty, false
}

// reflectTagLookup is reflect.StructTag.Get without importing reflect for
// a single call.
func reflectTagLookup(tag, key string) string {
	return string(structTag(tag).Get(key))
}

type structTag string

func (t structTag) Get(key string) string {
	for t != "" {
		i := 0
		for i < len(t) && t[i] == ' ' {
			i++
		}
		t = t[i:]
		if t == "" {
			break
		}
		i = 0
		for i < len(t) && t[i] > ' ' && t[i] != ':' && t[i] != '"' {
			i++
		}
		if i == 0 || i+1 >= len(t) || t[i] != ':' || t[i+1] != '"' {
			break
		}
		name := string(t[:i])
		t = t[i+1:]
		i = 1
		for i < len(t) && t[i] != '"' {
			if t[i] == '\\' {
				i++
			}
			i++
		}
		if i >= len(t) {
			break
		}
		qvalue := string(t[:i+1])
		t = t[i+1:]
		if key == name {
			return strings.Trim(qvalue, `"`)
		}
	}
	return ""
}
