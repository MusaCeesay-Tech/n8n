// Credit ledger. Append-only. The balance is the sum of the deltas, so the
// history is the source of truth and a grant can never be applied twice.

import type { Env, Tier } from './config';
import { entitlementsForTier } from './entitlements';

export interface LedgerEntry {
	id: number;
	delta: number;
	reason: string;
	ref: string | null;
	created_at: number;
}

export async function creditBalance(env: Env, discordId: string): Promise<number> {
	const row = await env.GRIDWORK_DB.prepare(
		`SELECT COALESCE(SUM(delta), 0) AS balance FROM credit_ledger WHERE discord_id = ?`,
	)
		.bind(discordId)
		.first<{ balance: number }>();
	return row?.balance ?? 0;
}

// Insert a ledger row. Returns false when `ref` already exists (a replay or a
// second event in the same period). Rows with a NULL ref always insert.
export async function grantCredits(
	env: Env,
	discordId: string,
	delta: number,
	reason: string,
	ref: string | null,
): Promise<boolean> {
	const result = await env.GRIDWORK_DB.prepare(
		`INSERT OR IGNORE INTO credit_ledger (discord_id, delta, reason, ref) VALUES (?, ?, ?, ?)`,
	)
		.bind(discordId, delta, reason, ref)
		.run();
	return (result.meta?.changes ?? 0) > 0;
}

// Grant one month of the tier's credits. The ref is per account per calendar
// month, so a renewal, a replayed webhook, or a second event in the same month
// grants at most once.
export async function grantMonthlyCredits(
	env: Env,
	discordId: string,
	tier: Tier,
	when: Date = new Date(),
): Promise<boolean> {
	const periodKey = `${when.getUTCFullYear()}-${String(when.getUTCMonth() + 1).padStart(2, '0')}`;
	return grantCredits(
		env,
		discordId,
		entitlementsForTier(tier).monthlyCredits,
		'monthly_grant',
		`${discordId}:monthly:${periodKey}`,
	);
}

export async function recentLedger(
	env: Env,
	discordId: string,
	limit = 50,
): Promise<LedgerEntry[]> {
	const { results } = await env.GRIDWORK_DB.prepare(
		`SELECT id, delta, reason, ref, created_at
		   FROM credit_ledger
		  WHERE discord_id = ?
		  ORDER BY id DESC
		  LIMIT ?`,
	)
		.bind(discordId, limit)
		.all<LedgerEntry>();
	return results ?? [];
}
