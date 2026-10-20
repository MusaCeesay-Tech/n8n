// Firebase Auth custom-token minting without the Admin SDK.
//
// A custom token is a JWT signed with the service account's RSA key. Firebase
// accepts it for signInWithCustomToken. We build and sign it with Web Crypto,
// which the Workers runtime provides, so no Node-only dependency is needed.

export interface ServiceAccount {
	client_email: string;
	private_key: string;
	private_key_id: string;
	project_id: string;
}

interface CustomTokenClaims {
	[k: string]: unknown;
}

const TOKEN_AUDIENCE =
	'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';

function base64UrlFromBytes(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlFromString(value: string): string {
	return base64UrlFromBytes(new TextEncoder().encode(value));
}

function pemToBytes(pem: string): Uint8Array {
	const body = pem
		.replace(/-----BEGIN PRIVATE KEY-----/, '')
		.replace(/-----END PRIVATE KEY-----/, '')
		.replace(/\s+/g, '');
	const binary = atob(body);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

export function parseServiceAccount(json: string): ServiceAccount {
	const account = JSON.parse(json) as ServiceAccount;
	if (!account.client_email || !account.private_key) {
		throw new Error('FIREBASE_SERVICE_ACCOUNT is missing client_email or private_key');
	}
	return account;
}

// Mint a Firebase custom token for the given uid.
export async function mintCustomToken(
	account: ServiceAccount,
	uid: string,
	claims?: CustomTokenClaims,
): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const header = { alg: 'RS256', typ: 'JWT', kid: account.private_key_id };
	const payload: Record<string, unknown> = {
		iss: account.client_email,
		sub: account.client_email,
		aud: TOKEN_AUDIENCE,
		iat: now,
		exp: now + 3600,
		uid,
	};
	if (claims && Object.keys(claims).length > 0) {
		payload.claims = claims;
	}

	const signingInput = `${base64UrlFromString(JSON.stringify(header))}.${base64UrlFromString(JSON.stringify(payload))}`;
	const key = await crypto.subtle.importKey(
		'pkcs8',
		pemToBytes(account.private_key),
		{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
		false,
		['sign'],
	);
	const signature = await crypto.subtle.sign(
		'RSASSA-PKCS1-v1_5',
		key,
		new TextEncoder().encode(signingInput),
	);
	return `${signingInput}.${base64UrlFromBytes(new Uint8Array(signature))}`;
}

// The Firebase uid we use for a Discord account. Deterministic, so the same
// Discord user always maps to the same Firebase user.
export function uidForDiscord(discordId: string): string {
	return `discord_${discordId}`;
}
