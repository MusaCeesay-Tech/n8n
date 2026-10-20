// Discord OAuth2 login and guild role management.

import type { Env, Tier } from './config';
import { roleIdForTier } from './config';

const DISCORD_API = 'https://discord.com/api/v10';

export interface DiscordUser {
	id: string;
	username: string;
	global_name?: string | null;
	email?: string | null;
	verified?: boolean;
}

export function buildAuthorizeUrl(env: Env, state: string, redirectUri: string): string {
	const params = new URLSearchParams({
		client_id: env.DISCORD_CLIENT_ID,
		redirect_uri: redirectUri,
		response_type: 'code',
		scope: 'identify email',
		state,
		prompt: 'consent',
	});
	return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

export async function exchangeCode(
	env: Env,
	code: string,
	redirectUri: string,
): Promise<{ access_token: string }> {
	const body = new URLSearchParams({
		client_id: env.DISCORD_CLIENT_ID,
		client_secret: env.DISCORD_CLIENT_SECRET,
		grant_type: 'authorization_code',
		code,
		redirect_uri: redirectUri,
	});
	const res = await fetch(`${DISCORD_API}/oauth2/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body,
	});
	if (!res.ok) {
		throw new Error(`Discord token exchange failed: ${res.status} ${await res.text()}`);
	}
	return (await res.json()) as { access_token: string };
}

export async function fetchDiscordUser(accessToken: string): Promise<DiscordUser> {
	const res = await fetch(`${DISCORD_API}/users/@me`, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	if (!res.ok) {
		throw new Error(`Discord user fetch failed: ${res.status}`);
	}
	return (await res.json()) as DiscordUser;
}

async function botApi(env: Env, method: string, path: string): Promise<Response> {
	return fetch(`${DISCORD_API}${path}`, {
		method,
		headers: {
			Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
			'Content-Type': 'application/json',
		},
	});
}

async function addRole(env: Env, discordId: string, roleId: string): Promise<void> {
	const res = await botApi(env, 'PUT', `/guilds/${env.DISCORD_GUILD_ID}/members/${discordId}/roles/${roleId}`);
	// 204 = added. 404 = member not in the guild yet; nothing to do.
	if (!res.ok && res.status !== 404) {
		throw new Error(`addRole ${roleId} -> ${res.status} ${await res.text()}`);
	}
}

async function removeRole(env: Env, discordId: string, roleId: string): Promise<void> {
	const res = await botApi(env, 'DELETE', `/guilds/${env.DISCORD_GUILD_ID}/members/${discordId}/roles/${roleId}`);
	if (!res.ok && res.status !== 404) {
		throw new Error(`removeRole ${roleId} -> ${res.status} ${await res.text()}`);
	}
}

// Make the member's tier roles match the tier. When active is false, all tier
// roles are removed. The bot must be in the guild with MANAGE_ROLES.
export async function syncTierRoles(
	env: Env,
	discordId: string,
	tier: Tier,
	active: boolean,
): Promise<void> {
	const tiers: Tier[] = ['basic', 'standard', 'premium'];
	for (const candidate of tiers) {
		const roleId = roleIdForTier(env, candidate);
		if (!roleId) {
			continue;
		}
		if (active && candidate === tier) {
			await addRole(env, discordId, roleId);
		} else {
			await removeRole(env, discordId, roleId);
		}
	}
}
