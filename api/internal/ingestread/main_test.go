package ingestread

import (
	"os"
	"testing"

	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
)

// TestMain switches this package into integration mode when
// TEST_DATABASE_URL is set: testsupport.Main applies core's migration chain
// and initialises platform.DBPool, so the queries in this package run against
// the real schema instead of never running at all.
func TestMain(m *testing.M) {
	os.Exit(testsupport.Main(m))
}
