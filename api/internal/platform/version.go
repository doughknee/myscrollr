package platform

import (
	"regexp"
	"strconv"
	"strings"
)

// semverRe accepts the shapes Scrollr ships: "1.7.3", "v1.7.3", "1.8.0-beta.2".
// Missing minor/patch count as 0, as in desktop/src/lib/releases.ts. Build
// metadata after "+" is ignored, as SemVer says.
var semverRe = regexp.MustCompile(`^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$`)

type semver struct {
	nums [3]int
	pre  []string
}

func parseSemver(v string) (semver, bool) {
	m := semverRe.FindStringSubmatch(strings.TrimSpace(v))
	if m == nil {
		return semver{}, false
	}
	var s semver
	for i := 0; i < 3; i++ {
		if m[i+1] != "" {
			n, err := strconv.Atoi(m[i+1])
			if err != nil {
				return semver{}, false
			}
			s.nums[i] = n
		}
	}
	if m[4] != "" {
		s.pre = strings.Split(m[4], ".")
	}
	return s, true
}

// ValidVersion reports whether v is a version CompareVersions can order.
func ValidVersion(v string) bool {
	_, ok := parseSemver(v)
	return ok
}

// IsPrerelease reports whether v carries a prerelease tag ("1.8.0-beta.2").
func IsPrerelease(v string) bool {
	s, ok := parseSemver(v)
	return ok && len(s.pre) > 0
}

// CompareVersions orders versions by SemVer precedence, matching the
// desktop's comparator: a release sorts above its own prereleases
// ("1.8.0-beta.2" < "1.8.0"), numeric prerelease identifiers compare as
// numbers ("beta.2" < "beta.10"), and a version that does not parse sorts
// below every version that does, so junk never claims to be newer. Returns
// -1, 0 or 1; two unparseable values compare equal.
func CompareVersions(a, b string) int {
	as, aok := parseSemver(a)
	bs, bok := parseSemver(b)
	switch {
	case !aok && !bok:
		return 0
	case !aok:
		return -1
	case !bok:
		return 1
	}
	for i := range as.nums {
		if as.nums[i] != bs.nums[i] {
			if as.nums[i] < bs.nums[i] {
				return -1
			}
			return 1
		}
	}
	switch {
	case len(as.pre) == 0 && len(bs.pre) == 0:
		return 0
	case len(as.pre) == 0:
		return 1
	case len(bs.pre) == 0:
		return -1
	}
	for i := 0; i < len(as.pre) && i < len(bs.pre); i++ {
		if c := comparePreID(as.pre[i], bs.pre[i]); c != 0 {
			return c
		}
	}
	switch {
	case len(as.pre) < len(bs.pre):
		return -1
	case len(as.pre) > len(bs.pre):
		return 1
	}
	return 0
}

// comparePreID: numeric identifiers compare as numbers and sort below
// alphanumeric ones, which compare as strings.
func comparePreID(a, b string) int {
	an, aerr := strconv.Atoi(a)
	bn, berr := strconv.Atoi(b)
	switch {
	case aerr == nil && berr == nil:
		if an < bn {
			return -1
		} else if an > bn {
			return 1
		}
		return 0
	case aerr == nil:
		return -1
	case berr == nil:
		return 1
	}
	return strings.Compare(a, b)
}
