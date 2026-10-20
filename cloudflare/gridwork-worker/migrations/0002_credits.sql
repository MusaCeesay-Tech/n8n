-- Append-only credit ledger and monthly-grant de-duplication.

CREATE TABLE IF NOT EXISTS credit_ledger (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	discord_id TEXT NOT NULL,
	delta INTEGER NOT NULL,
	reason TEXT NOT NULL,
	ref TEXT,
	created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_discord ON credit_ledger (discord_id);

-- One grant per ref. A replayed webhook or a second event in the same billing
-- period can not credit the account twice. Rows with a NULL ref are always
-- inserted (the partial index only covers non-NULL refs).
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_ledger_ref ON credit_ledger (ref) WHERE ref IS NOT NULL;

-- Look up the Discord account from a Firebase uid.
CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON users (firebase_uid);
