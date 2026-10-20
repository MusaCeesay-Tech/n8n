// Gridwork edge Worker.
//
// Three jobs:
//   1. Discord login: OAuth2 with Discord, then mint a Firebase custom token.
//   2. Whop webhooks: verify, de-duplicate, sync Discord tier roles, grant credits.
//   3. Read API: the app reads its own tier and credit balance (Firebase token).

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, Tier } from './config';
import { mintCustomToken, parseServiceAccount, uidForDiscord } from './firebase';
import { verifyFirebaseIdToken, type FirebaseClaims } from './auth';
import {
	buildAuthorizeUrl,
	exchangeCode,
	fetchDiscordUser,
	syncTierRoles,
	type DiscordUser,
} from './discord';
import { entitlementsForTier } from './entitlements';
import { creditBalance, grantMonthlyCredits, recentLedger } from './credits';
import { resolveEvent, verifyWhopSignature } from './whop';
import {
	findUserByEmail,
	getMembership,
	getUserByDiscordId,
	getUserByFirebaseUid,
	recordEvent,
	rememberUser,
	setMembership,
} from './store';

const app = new Hono<{ Bindings: Env }>();

const STATE_TTL_SECONDS = 600;

function toBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesFromBase64Url(value: string): Uint8Array {
	const padded = value.replace(/-/g, '+').replace(/_/g, '/');
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

async function hmacBase64Url(secret: string, message: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	const mac = new Uint8Array(
		await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)),
	);
	return toBase64Url(mac);
}

async function signState(env: Env, payload: Record<string, unknown>): Promise<string> {
	const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
	const signature = await hmacBase64Url(env.SESSION_SECRET, body);
	return `${body}.${signature}`;
}

async function verifyState(env: Env, state: string): Promise<Record<string, unknown> | null> {
	const [body, signature] = state.split('.');
	if (!body || !signature) {
		return null;
	}
	const expected = await hmacBase64Url(env.SESSION_SECRET, body);
	if (expected !== signature) {
		return null;
	}
	try {
		const payload = JSON.parse(new TextDecoder().decode(bytesFromBase64Url(body))) as Record<
			string,
			unknown
		>;
		const issued = typeof payload.t === 'number' ? payload.t : 0;
		if (Math.floor(Date.now() / 1000) - issued > STATE_TTL_SECONDS) {
			return null;
		}
		return payload;
	} catch {
		return null;
	}
}

function html(body: string, status = 200): Response {
	return new Response(body, {
		status,
		headers: { 'content-type': 'text/html; charset=utf-8' },
	});
}

function callbackPage(env: Env, token: string, user: DiscordUser): Response {
	const appOrigin = new URL(env.APP_URL).origin;
	const payload = JSON.stringify({
		type: 'gridwork-auth',
		customToken: token,
		discord: { id: user.id, username: user.username, globalName: user.global_name ?? null },
	});
	const htmlBody = `<!doctype html>
<html><head><meta charset="utf-8"><title>Gridwork</title></head>
<body style="font-family:system-ui;background:#fff;color:#222;text-align:center;padding-top:80px">
<p>Signing you in to Gridwork…</p>
<script>
(function () {
  var payload = ${payload};
  if (window.opener) {
    try { window.opener.postMessage(payload, ${JSON.stringify(appOrigin)}); } catch (e) {}
    window.close();
  } else {
    window.location.replace(${JSON.stringify(env.APP_URL)} + '/#customToken=' + encodeURIComponent(payload.customToken));
  }
})();
</script>
</body></html>`;
	return html(htmlBody);
}

function errorPage(message: string): Response {
	return html(
		`<!doctype html><html><head><meta charset="utf-8"><title>Gridwork</title></head>
<body style="font-family:system-ui;padding:40px"><h1>Sign-in failed</h1><p>${message}</p></body></html>`,
		400,
	);
}

function callbackRedirectUri(url: string): string {
	return `${new URL(url).origin}/auth/discord/callback`;
}

app.get('/', (c) => c.json({ ok: true, name: 'gridwork-worker', env: c.env.ENV }));

app.get('/health', (c) => c.json({ ok: true, time: Date.now() }));

// Start Discord login. Redirects the browser to Discord's consent screen.
app.get('/auth/discord', async (c) => {
	if (!c.env.SESSION_SECRET) {
		return c.json({ ok: false, error: 'SESSION_SECRET is not configured' }, 500);
	}
	const state = await signState(c.env, { t: Math.floor(Date.now() / 1000), n: crypto.randomUUID() });
	const url = buildAuthorizeUrl(c.env, state, callbackRedirectUri(c.req.url));
	return c.redirect(url);
});

// Discord redirects back here with a code. Exchange it, then return a page that
// hands a Firebase custom token back to the app.
app.get('/auth/discord/callback', async (c) => {
	const error = c.req.query('error');
	if (error) {
		return errorPage(`Discord returned: ${error}`);
	}
	const code = c.req.query('code');
	const state = c.req.query('state');
	if (!code || !state) {
		return errorPage('Missing code or state.');
	}
	if (!c.env.SESSION_SECRET) {
		return errorPage('SESSION_SECRET is not configured.');
	}
	if (!(await verifyState(c.env, state))) {
		return errorPage('Invalid or expired state.');
	}

	try {
		const redirectUri = callbackRedirectUri(c.req.url);
		const tokens = await exchangeCode(c.env, code, redirectUri);
		const user = await fetchDiscordUser(tokens.access_token);
		const uid = uidForDiscord(user.id);

		await rememberUser(c.env, {
			discordId: user.id,
			username: user.global_name ?? user.username,
			email: user.email ?? null,
			firebaseUid: uid,
		});

		// If a membership already exists for this account, re-apply the roles.
		const existing = await getMembership(c.env, user.id);
		if (existing) {
			c.executionCtx.waitUntil(
				syncTierRoles(c.env, user.id, existing.plan, existing.status === 'active'),
			);
		}

		const account = parseServiceAccount(c.env.FIREBASE_SERVICE_ACCOUNT);
		const token = await mintCustomToken(account, uid, {
			discord_id: user.id,
			discord_username: user.username,
		});
		return callbackPage(c.env, token, user);
	} catch (caught) {
		return errorPage(caught instanceof Error ? caught.message : String(caught));
	}
});

// Whop membership webhooks. Verify, de-duplicate, then sync Discord roles.
app.post('/webhooks/whop', async (c) => {
	const rawBody = await c.req.text();
	const valid = await verifyWhopSignature(c.env.WHOP_WEBHOOK_SECRET, c.req.raw.headers, rawBody);
	if (!valid) {
		return c.json({ ok: false, error: 'bad signature' }, 401);
	}

	const eventId = c.req.raw.headers.get('webhook-id') ?? '';
	if (eventId && !(await recordEvent(c.env, eventId))) {
		return c.json({ ok: true, duplicate: true });
	}

	let event: Record<string, unknown>;
	try {
		event = JSON.parse(rawBody) as Record<string, unknown>;
	} catch {
		return c.json({ ok: true, ignored: 'unparseable' });
	}

	c.executionCtx.waitUntil(handleWhopEvent(c.env, event));
	return c.json({ ok: true });
});

async function handleWhopEvent(env: Env, event: Record<string, unknown>): Promise<void> {
	const resolved = resolveEvent(env, event);
	let discordId = resolved.discordId;

	if (!discordId && resolved.email) {
		const user = await findUserByEmail(env, resolved.email);
		discordId = user?.discord_id;
	}
	if (!discordId) {
		console.log('whop: no Discord account for event', resolved.type, resolved.membershipId);
		return;
	}

	const tier: Tier = resolved.active ? resolved.tier : 'basic';
	await setMembership(env, {
		discordId,
		whopMembershipId: resolved.membershipId,
		plan: tier,
		status: resolved.active ? 'active' : 'inactive',
	});
	if (resolved.active) {
		// One grant per account per calendar month, whatever events arrive.
		await grantMonthlyCredits(env, discordId, tier);
	}
	await syncTierRoles(env, discordId, tier, resolved.active);
}

// ---------------------------------------------------------------------------
// Read API. The app presents a Firebase ID token and reads its own tier and
// credit balance. Every route below requires a valid token.
// ---------------------------------------------------------------------------

type ApiEnv = { Bindings: Env; Variables: { claims: FirebaseClaims } };

const api = new Hono<ApiEnv>();

api.use(
	'*',
	cors({
		origin: '*',
		allowHeaders: ['authorization', 'content-type'],
		allowMethods: ['GET', 'OPTIONS'],
	}),
);

api.use('*', async (c, next) => {
	const header = c.req.header('authorization') ?? '';
	const idToken = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
	if (!idToken) {
		return c.json({ ok: false, error: 'missing bearer token' }, 401);
	}

	let projectId: string;
	try {
		projectId = parseServiceAccount(c.env.FIREBASE_SERVICE_ACCOUNT).project_id;
	} catch {
		return c.json({ ok: false, error: 'firebase is not configured' }, 500);
	}

	const claims = await verifyFirebaseIdToken(idToken, projectId);
	if (!claims) {
		return c.json({ ok: false, error: 'invalid token' }, 401);
	}

	c.set('claims', claims);
	await next();
});

interface ResolvedAccount {
	discordId?: string;
	email?: string;
}

// Map a Firebase identity to a Gridwork (Discord) account. Discord sign-ins use
// a `discord_<id>` uid. Native sign-ins (email/Google/GitHub) match by the
// stored firebase_uid, then by email.
async function resolveAccount(env: Env, claims: FirebaseClaims): Promise<ResolvedAccount> {
	const prefix = 'discord_';
	if (claims.uid.startsWith(prefix)) {
		const discordId = claims.uid.slice(prefix.length);
		const user = await getUserByDiscordId(env, discordId);
		return { discordId, email: user?.email ?? claims.email };
	}

	const byUid = await getUserByFirebaseUid(env, claims.uid);
	if (byUid) {
		return { discordId: byUid.discord_id, email: byUid.email ?? claims.email };
	}

	if (claims.email) {
		const byEmail = await findUserByEmail(env, claims.email);
		if (byEmail) {
			return { discordId: byEmail.discord_id, email: byEmail.email ?? claims.email };
		}
	}

	return { email: claims.email };
}

// Effective tier: a lapsed or inactive membership falls back to Basic.
async function resolveEntitlements(env: Env, account: ResolvedAccount) {
	const membership = account.discordId ? await getMembership(env, account.discordId) : null;
	const tier: Tier = membership && membership.status === 'active' ? membership.plan : 'basic';
	const balance = account.discordId ? await creditBalance(env, account.discordId) : 0;
	return { membership, tier, balance };
}

api.get('/me', async (c) => {
	const claims = c.get('claims');
	const account = await resolveAccount(c.env, claims);
	const { membership, tier, balance } = await resolveEntitlements(c.env, account);

	return c.json({
		ok: true,
		uid: claims.uid,
		account: {
			discordId: account.discordId ?? null,
			email: account.email ?? null,
		},
		tier,
		status: membership?.status ?? 'active',
		currentPeriodEnd: membership?.current_period_end ?? null,
		credits: { balance },
		entitlements: entitlementsForTier(tier),
	});
});

api.get('/me/credits', async (c) => {
	const claims = c.get('claims');
	const account = await resolveAccount(c.env, claims);
	const balance = account.discordId ? await creditBalance(c.env, account.discordId) : 0;
	const entries = account.discordId ? await recentLedger(c.env, account.discordId) : [];

	return c.json({ ok: true, balance, entries });
});

app.route('/api', api);

export default app;
