package events

import (
	"os"
	"testing"

	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
)

// TestMain switches this package into integration mode when
// TEST_DATABASE_URL is set. See testsupport.Main for what that entails.
func TestMain(m *testing.M) {
	os.Exit(testsupport.Main(m))
}
