package platform

import (
	"errors"
	"testing"
)

func TestEncryptRoundTrip(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", "0123456789abcdef")
	sealed, err := Encrypt("ghu_secret")
	if err != nil {
		t.Fatal(err)
	}
	if sealed == "ghu_secret" {
		t.Fatal("ciphertext equals plaintext")
	}
	if got, err := Decrypt(sealed); err != nil || got != "ghu_secret" {
		t.Fatalf("Decrypt = %q, %v", got, err)
	}
	t.Setenv("ENCRYPTION_KEY", "another-key")
	if _, err := Decrypt(sealed); err == nil {
		t.Fatal("decrypt with the wrong key succeeded")
	}
	t.Setenv("ENCRYPTION_KEY", "")
	if _, err := Encrypt("x"); !errors.Is(err, ErrNoEncryptionKey) {
		t.Fatalf("want ErrNoEncryptionKey, got %v", err)
	}
}
