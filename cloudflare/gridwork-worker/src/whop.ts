// Whop webhook verification and interpretation.
//
// Whop follows the Standard Webhooks spec. The headers webhook-id,
// webhook-timestamp and webhook-signature are signed together with the raw
// body: HMAC-SHA256 over `${id}.${timestamp}.${rawBody}`, base64 encoded, with a
// `v1,` prefix. The key is the secret exactly as Whop issued it.

import type { Env, Tier } from './config';

const TOLERANCE_SECONDS = 300;

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) {
		return false;
	}
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}

export async function verifyWhopSignature(
	secret: string,
	headers: Headers,
	rawBody: string,
): Promise<boolean> {
	const id = headers.get('webhook-id');
	const timestamp = headers.get('webhook-timestamp');
	const signatureHeader = headers.get('webhook-signature');
	if (!id || !timestamp || !signatureHeader) {
		return false;
	}

	const timestampSeconds = Number(timestamp);
	if (!Number.isFinite(timestampSeconds)) {
		return false;
	}
	const nowSeconds = Math.floor(Date.now() / 1000);
	if (Math.abs(nowSeconds - timestampSeconds) > TOLERANCE_SECONDS) {
		return false;
	}

	const signedContent = `${id}.${timestamp}.${rawBody}`;
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	const mac = new Uint8Array(
		await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent)),
	);
	let binary = '';
	for (const byte of mac) {
		binary += String.fromCharCode(byte);
	}
	const expected = btoa(binary);

	for (const part of signatureHeader.split(' ')) {
		const comma = part.indexOf(',');
		if (comma === -1) {
			continue;
		}
		const version = part.slice(0, comma);
		const signature = part.slice(comma + 1);
		if (version === 'v1' && timingSafeEqual(signature, expected)) {
			return true;
		}
	}
	return false;
}

export interface ResolvedEvent {
	type: string;
	tier: Tier;
	active: boolean;
	discordId?: string;
	email?: string;
	membershipId?: string;
}

// Collect every string value in the payload.
function collectStrings(value: unknown, out: string[] = []): string[] {
	if (typeof value === 'string') {
		out.push(value);
	} else if (Array.isArray(value)) {
		for (const item of value) {
			collectStrings(item, out);
		}
	} else if (value && typeof value === 'object') {
		for (const item of Object.values(value as Record<string, unknown>)) {
			collectStrings(item, out);
		}
	}
	return out;
}

// Find the first value under any of the given keys, breadth first.
function findKey(value: unknown, keys: string[]): string | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const queue: unknown[] = [value];
	while (queue.length > 0) {
		const current = queue.shift();
		if (Array.isArray(current)) {
			queue.push(...current);
			continue;
		}
		if (current && typeof current === 'object') {
			const record = current as Record<string, unknown>;
			for (const key of keys) {
				const found = record[key];
				if (typeof found === 'string' && found.length > 0) {
					return found;
				}
			}
			queue.push(...Object.values(record));
		}
	}
	return undefined;
}

const INACTIVE_MARKERS = [
	'cancel',
	'deactivat',
	'expire',
	'delete',
	'revoke',
	'fail',
	'refund',
	'past_due',
	'uncollectible',
];

export function resolveEvent(env: Env, event: Record<string, unknown>): ResolvedEvent {
	const type = typeof event.type === 'string' ? event.type : 'unknown';
	const strings = collectStrings(event);

	let tier: Tier = 'basic';
	if (env.WHOP_PLAN_PREMIUM && strings.includes(env.WHOP_PLAN_PREMIUM)) {
		tier = 'premium';
	} else if (env.WHOP_PLAN_STANDARD && strings.includes(env.WHOP_PLAN_STANDARD)) {
		tier = 'standard';
	}

	const loweredType = type.toLowerCase();
	const inactiveByType = INACTIVE_MARKERS.some((marker) => loweredType.includes(marker));
	const statusValue = findKey(event, ['status', 'membership_status', 'state'])?.toLowerCase();
	const inactiveByStatus = statusValue
		? INACTIVE_MARKERS.some((marker) => statusValue.includes(marker)) || statusValue === 'inactive'
		: false;
	const activeFlag = findKey(event, ['active', 'is_active', 'valid']);

	// A payment failure is a grace signal, not an immediate downgrade. The
	// billing worker decides grace; here a failure keeps the current tier and
	// marks it inactive only for hard cancellations.
	const active = !inactiveByType && !inactiveByStatus && activeFlag !== 'false';

	return {
		type,
		tier,
		active,
		discordId: findKey(event, ['discord_id', 'discordId', 'discord_user_id']),
		email: findKey(event, ['email', 'user_email', 'customer_email']),
		membershipId: findKey(event, ['membership_id', 'membershipId']),
	};
}
