-- Gridwork edge Worker schema.

CREATE TABLE IF NOT EXISTS users (
	discord_id TEXT PRIMARY KEY,
	username TEXT,
	email TEXT,
	firebase_uid TEXT,
	created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

CREATE TABLE IF NOT EXISTS memberships (
	discord_id TEXT PRIMARY KEY,
	whop_membership_id TEXT,
	plan TEXT NOT NULL DEFAULT 'basic',
	status TEXT NOT NULL DEFAULT 'inactive',
	current_period_end INTEGER,
	updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- At-least-once delivery de-duplication. The webhook-id header is the key.
CREATE TABLE IF NOT EXISTS webhook_events (
	id TEXT PRIMARY KEY,
	received_at INTEGER NOT NULL DEFAULT (unixepoch())
);
