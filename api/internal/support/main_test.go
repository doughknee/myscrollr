package support

import (
	"os"
	"testing"

	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
)

// TestMain switches the package into integration mode when
// TEST_DATABASE_URL is set (real migrations in a package-private schema);
// DB-backed tests skip otherwise. See testsupport.Main.
func TestMain(m *testing.M) { os.Exit(testsupport.Main(m)) }
