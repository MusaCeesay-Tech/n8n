// Bindings and configuration for the Gridwork edge Worker.

export interface Env {
	// Public configuration (wrangler [vars]).
	ENV: string;
	DISCORD_CLIENT_ID: string;
	DISCORD_GUILD_ID: string;
	DISCORD_ROLE_BASIC: string;
	DISCORD_ROLE_STANDARD: string;
	DISCORD_ROLE_PREMIUM: string;
	APP_URL: string;
	WHOP_PLAN_STANDARD: string;
	WHOP_PLAN_PREMIUM: string;

	// Secrets (wrangler secret put).
	DISCORD_BOT_TOKEN: string;
	DISCORD_CLIENT_SECRET: string;
	WHOP_WEBHOOK_SECRET: string;
	FIREBASE_SERVICE_ACCOUNT: string;
	SESSION_SECRET: string;

	// D1 database.
	GRIDWORK_DB: D1Database;
}

export type Tier = 'basic' | 'standard' | 'premium';

export function roleIdForTier(env: Env, tier: Tier): string {
	switch (tier) {
		case 'premium':
			return env.DISCORD_ROLE_PREMIUM;
		case 'standard':
			return env.DISCORD_ROLE_STANDARD;
		default:
			return env.DISCORD_ROLE_BASIC;
	}
}
