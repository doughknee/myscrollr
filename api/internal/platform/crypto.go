package platform

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
)

// ErrNoEncryptionKey means ENCRYPTION_KEY is unset, so nothing that needs a
// stored third-party token can work.
var ErrNoEncryptionKey = errors.New("ENCRYPTION_KEY not set")

// tokenAEAD builds AES-256-GCM from ENCRYPTION_KEY. The key is SHA-256 of the
// env value, so its format (hex, base64, a passphrase) does not matter.
func tokenAEAD() (cipher.AEAD, error) {
	raw := os.Getenv("ENCRYPTION_KEY")
	if raw == "" {
		return nil, ErrNoEncryptionKey
	}
	key := sha256.Sum256([]byte(raw))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, fmt.Errorf("aes: %w", err)
	}
	return cipher.NewGCM(block)
}

// Encrypt seals plaintext with AES-GCM and returns base64(nonce||ciphertext).
func Encrypt(plaintext string) (string, error) {
	aead, err := tokenAEAD()
	if err != nil {
		return "", err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("nonce: %w", err)
	}
	return base64.StdEncoding.EncodeToString(aead.Seal(nonce, nonce, []byte(plaintext), nil)), nil
}

// Decrypt reverses Encrypt.
func Decrypt(encoded string) (string, error) {
	aead, err := tokenAEAD()
	if err != nil {
		return "", err
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", fmt.Errorf("decode: %w", err)
	}
	n := aead.NonceSize()
	if len(data) < n {
		return "", errors.New("ciphertext too short")
	}
	plain, err := aead.Open(nil, data[:n], data[n:], nil)
	if err != nil {
		return "", fmt.Errorf("open: %w", err)
	}
	return string(plain), nil
}
