# gridwork-worker

Cloudflare Worker for Gridwork. It does three things:

1. **Discord login.** OAuth2 with Discord, then mints a Firebase custom token so
   the app can call `signInWithCustomToken`. Firebase Auth has no native Discord
   provider, so this Worker is the bridge.
2. **Whop membership webhooks.** Verifies the signature, de-duplicates the
   event, syncs the member's Discord tier role, and grants monthly credits.
3. **Read API.** The app presents a Firebase ID token and reads its own tier and
   credit balance.

## Layout

| File | Purpose |
|------|---------|
| `src/index.ts` | Hono router: `/health`, `/auth/discord`, `/auth/discord/callback`, `/webhooks/whop`, `/api/*` |
| `src/firebase.ts` | Mint a Firebase custom token (RS256 JWT via Web Crypto) |
| `src/auth.ts` | Verify a Firebase ID token against Google's JWKS |
| `src/discord.ts` | Discord OAuth token exchange and guild role management |
| `src/whop.ts` | Standard Webhooks signature check and event interpretation |
| `src/credits.ts` | Append-only credit ledger: balance, idempotent grants |
| `src/entitlements.ts` | Tier limits (credits, agents, tasks, features) |
| `src/store.ts` | D1 queries (users, memberships, webhook de-duplication) |
| `migrations/` | D1 schema |

## One-time setup

```powershell
npm install
npx wrangler login                     # or set CLOUDFLARE_API_TOKEN
npx wrangler d1 create gridwork        # copy database_id into wrangler.toml
npx wrangler d1 migrations apply gridwork --remote
```

Set the secrets (values are never written to disk):

```powershell
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put DISCORD_CLIENT_SECRET
npx wrangler secret put WHOP_WEBHOOK_SECRET
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT   # paste the whole JSON
npx wrangler secret put SESSION_SECRET             # any long random string
```

Discord Developer Portal, OAuth2 redirect URI:

```
https://gridwork-worker.<your-subdomain>.workers.dev/auth/discord/callback
```

Firebase: create a service account key in project `gridworkai`
(IAM and Admin > Service Accounts > Keys > Add key > JSON). Paste the file as
`FIREBASE_SERVICE_ACCOUNT`.

Whop: add a webhook endpoint pointing at
`https://gridwork-worker.<your-subdomain>.workers.dev/webhooks/whop`, and copy
its `ws_...` secret into `WHOP_WEBHOOK_SECRET`. Set the plan ids in
`wrangler.toml` (`WHOP_PLAN_STANDARD`, `WHOP_PLAN_PREMIUM`).

## Deploy

```powershell
npx wrangler deploy
```

## Local development

```powershell
Copy-Item .dev.vars.example .dev.vars     # then fill in the values
npx wrangler d1 migrations apply gridwork --local
npm run dev
```

## Read API

The app sends its Firebase ID token (from `signInWithCustomToken`, Google,
GitHub, or email/password) as a bearer token.

```powershell
curl.exe https://gridwork-worker.<your-subdomain>.workers.dev/api/me `
  -H "Authorization: Bearer <firebase-id-token>"
```

`GET /api/me` returns the tier, status, current period end, credit balance, and
the tier's entitlements. `GET /api/me/credits` returns the balance plus the 50
most recent ledger entries.

The account is the Discord id. A `discord_<id>` uid maps straight to it; other
sign-ins match the stored `firebase_uid`, then the email. A lapsed membership
falls back to Basic.

## How a login becomes a role

1. The app opens `/auth/discord` in a popup.
2. Discord redirects to `/auth/discord/callback` with a code.
3. The Worker exchanges the code, reads the Discord user, and stores the mapping
   in D1 (`users.discord_id` -> `firebase_uid`).
4. The Worker returns a page that posts a Firebase custom token back to the app.
5. When Whop sends a membership webhook, the Worker finds the Discord id (from
   checkout metadata `discord_id`, or by email) and adds the matching tier role.
