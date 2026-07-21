package platform

import "strings"

// maskEmail returns a PII-safe representation of an email address for logs.
// Format: first char of local + "***@" + first char of domain + "***" + TLD.
//
//	"user@domain.com"   -> "u***@d***.com"
//	"a@b.co"            -> "a***@b***.co"
//	"jane@example.co.uk"-> "j***@e***.uk"
//
// Empty or malformed inputs are returned unchanged so log lines are never
// silently broken, but the common well-formed case is reliably scrubbed.
func MaskEmail(email string) string {
	at := strings.IndexByte(email, '@')
	if at <= 0 || at == len(email)-1 {
		return email
	}
	local := email[:at]
	domain := email[at+1:]

	dot := strings.LastIndexByte(domain, '.')
	if dot <= 0 || dot == len(domain)-1 {
		return email
	}
	tld := domain[dot:] // includes the dot
	return string(local[0]) + "***@" + string(domain[0]) + "***" + tld
}
