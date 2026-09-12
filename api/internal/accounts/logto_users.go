package accounts

import (
	"fmt"
	"time"
)

// =============================================================================
// Logto Management API — every account, for rolling-window growth
// =============================================================================
//
// Logto's own dashboard endpoints answer "today" and "last 7 days" on its
// calendar, which is not the rolling 24h / 7d / 30d contract the staff
// dashboard uses (SCROLLR-210). For a few hundred accounts the honest way to
// count "created in the last 7 days, and the 7 days before that" is to page
// the accounts and look at createdAt. The caller caches the result.

// LogtoAccount is the minimum the growth report needs about one account.
type LogtoAccount struct {
	ID            string `json:"id"`
	CreatedAt     int64  `json:"created_at"`
	LastSignInAt  int64  `json:"last_sign_in_at"`
	ApplicationID string `json:"application_id"`
	IsSuspended   bool   `json:"is_suspended"`
}

// logtoMaxAccountPages caps the walk. 50 pages of 100 is 5,000 accounts; past
// that the listing reports itself as partial rather than spending the
// dashboard's time on a walk that would take a minute.
const logtoMaxAccountPages = 50

// ListAllLogtoAccounts pages /api/users. total is Logto's own count from the
// response header; partial is true when the walk stopped before reaching it.
func ListAllLogtoAccounts() (accounts []LogtoAccount, total int, partial bool, err error) {
	for page := 1; page <= logtoMaxAccountPages; page++ {
		users, pageTotal, err := ListLogtoUsers(page, logtoMaxPageSize, "")
		if err != nil {
			return nil, 0, false, fmt.Errorf("page %d: %w", page, err)
		}
		total = pageTotal
		for _, u := range users {
			accounts = append(accounts, LogtoAccount{
				ID: u.ID, CreatedAt: u.CreatedAt, LastSignInAt: u.LastSignInAt,
				ApplicationID: u.ApplicationID, IsSuspended: u.IsSuspended,
			})
		}
		if len(users) < logtoMaxPageSize || len(accounts) >= total {
			return accounts, total, false, nil
		}
	}
	return accounts, total, true, nil
}

// CreatedTime is the account's creation instant.
func (a LogtoAccount) CreatedTime() time.Time { return time.UnixMilli(a.CreatedAt).UTC() }
