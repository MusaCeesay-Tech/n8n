// D1 persistence: users, memberships, and webhook de-duplication.

import type { Env, Tier } from './config';

export interface StoredUser {
	discord_id: string;
	username: string | null;
	email: string | null;
	firebase_uid: string | null;
}

export async function rememberUser(
	env: Env,
	user: { discordId: string; username?: string | null; email?: string | null; firebaseUid?: string | null },
): Promise<void> {
	await env.GRIDWORK_DB.prepare(
		`INSERT INTO users (discord_id, username, email, firebase_uid)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(discord_id) DO UPDATE SET
		   username = COALESCE(excluded.username, users.username),
		   email = COALESCE(excluded.email, users.email),
		   firebase_uid = COALESCE(excluded.firebase_uid, users.firebase_uid)`,
	)
		.bind(user.discordId, user.username ?? null, user.email ?? null, user.firebaseUid ?? null)
		.run();
}

export async function findUserByEmail(env: Env, email: string): Promise<StoredUser | null> {
	return env.GRIDWORK_DB.prepare(`SELECT * FROM users WHERE lower(email) = lower(?) LIMIT 1`)
		.bind(email)
		.first<StoredUser>();
}

export async function getUserByDiscordId(env: Env, discordId: string): Promise<StoredUser | null> {
	return env.GRIDWORK_DB.prepare(`SELECT * FROM users WHERE discord_id = ? LIMIT 1`)
		.bind(discordId)
		.first<StoredUser>();
}

export async function getUserByFirebaseUid(env: Env, firebaseUid: string): Promise<StoredUser | null> {
	return env.GRIDWORK_DB.prepare(`SELECT * FROM users WHERE firebase_uid = ? LIMIT 1`)
		.bind(firebaseUid)
		.first<StoredUser>();
}

// Returns true when the event id is new, false when it was already handled.
export async function recordEvent(env: Env, id: string): Promise<boolean> {
	const result = await env.GRIDWORK_DB.prepare(
		`INSERT OR IGNORE INTO webhook_events (id) VALUES (?)`,
	)
		.bind(id)
		.run();
	return (result.meta?.changes ?? 0) > 0;
}

export interface MembershipInput {
	discordId: string;
	whopMembershipId?: string | null;
	plan: Tier;
	status: string;
	currentPeriodEnd?: number | null;
}

export async function setMembership(env: Env, input: MembershipInput): Promise<void> {
	await env.GRIDWORK_DB.prepare(
		`INSERT INTO memberships (discord_id, whop_membership_id, plan, status, current_period_end, updated_at)
		 VALUES (?, ?, ?, ?, ?, unixepoch())
		 ON CONFLICT(discord_id) DO UPDATE SET
		   whop_membership_id = COALESCE(excluded.whop_membership_id, memberships.whop_membership_id),
		   plan = excluded.plan,
		   status = excluded.status,
		   current_period_end = COALESCE(excluded.current_period_end, memberships.current_period_end),
		   updated_at = unixepoch()`,
	)
		.bind(
			input.discordId,
			input.whopMembershipId ?? null,
			input.plan,
			input.status,
			input.currentPeriodEnd ?? null,
		)
		.run();
}

export interface StoredMembership {
	plan: Tier;
	status: string;
	current_period_end: number | null;
}

export async function getMembership(env: Env, discordId: string): Promise<StoredMembership | null> {
	return env.GRIDWORK_DB.prepare(
		`SELECT plan, status, current_period_end FROM memberships WHERE discord_id = ?`,
	)
		.bind(discordId)
		.first<StoredMembership>();
}
