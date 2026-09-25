package support

import (
	"os"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
)

// TestMain switches the package into integration mode when
// TEST_DATABASE_URL is set (real migrations in a package-private schema);
// DB-backed tests skip otherwise. See testsupport.Main.
//
// The support reset (SupportEpoch) is switched off for the suite: the
// fixtures predate it and are about queue logic, not the cutoff. The one
// test of the cutoff itself sets the epoch back explicitly.
func TestMain(m *testing.M) {
	SupportEpoch = time.Time{}
	os.Exit(testsupport.Main(m))
}
