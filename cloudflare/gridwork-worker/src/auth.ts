// Verify a Firebase ID token.
//
// The app signs in with Firebase Auth (custom token from Discord, or a native
// provider), then sends the resulting ID token as `Authorization: Bearer ...`.
// An ID token is an RS256 JWT signed by Google. We verify it against Google's
// public JWKS for the project, with Web Crypto. No Admin SDK needed.

const JWKS_URL =
	'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

interface JwkSet {
	keys: (JsonWebKey & { kid?: string })[];
}

// Module-scope cache. A Worker isolate reuses it across requests. We honour the
// response Cache-Control max-age so a rotated key is picked up.
let jwksCache: { keys: JwkSet['keys']; expiresAt: number } | null = null;

function base64UrlToBytes(value: string): Uint8Array {
	const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
	const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
	const binary = atob(normalized + pad);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

function decodeJson<T>(segment: string): T {
	return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment))) as T;
}

async function getJwks(): Promise<JwkSet['keys']> {
	const now = Date.now();
	if (jwksCache && jwksCache.expiresAt > now) {
		return jwksCache.keys;
	}
	const res = await fetch(JWKS_URL);
	if (!res.ok) {
		throw new Error(`JWKS fetch failed: ${res.status}`);
	}
	const body = (await res.json()) as JwkSet;
	const cacheControl = res.headers.get('cache-control') ?? '';
	const match = /max-age=(\d+)/.exec(cacheControl);
	const maxAgeSeconds = match ? Number(match[1]) : 3600;
	jwksCache = { keys: body.keys, expiresAt: now + maxAgeSeconds * 1000 };
	return body.keys;
}

export interface FirebaseClaims {
	uid: string;
	email?: string;
	emailVerified: boolean;
	signInProvider?: string;
	raw: Record<string, unknown>;
}

interface IdTokenPayload {
	sub?: string;
	aud?: string;
	iss?: string;
	exp?: number;
	iat?: number;
	email?: string;
	email_verified?: boolean;
	firebase?: { sign_in_provider?: string };
	[k: string]: unknown;
}

// Returns the verified claims, or null when the token is missing, malformed,
// expired, signed by the wrong key, or issued for another project.
export async function verifyFirebaseIdToken(
	idToken: string,
	projectId: string,
): Promise<FirebaseClaims | null> {
	const parts = idToken.split('.');
	if (parts.length !== 3) {
		return null;
	}
	const [headerSegment, payloadSegment, signatureSegment] = parts;

	let header: { alg?: string; kid?: string };
	let payload: IdTokenPayload;
	try {
		header = decodeJson<{ alg?: string; kid?: string }>(headerSegment);
		payload = decodeJson<IdTokenPayload>(payloadSegment);
	} catch {
		return null;
	}
	if (header.alg !== 'RS256' || !header.kid) {
		return null;
	}

	const keys = await getJwks();
	const jwk = keys.find((key) => key.kid === header.kid);
	if (!jwk) {
		return null;
	}

	const key = await crypto.subtle.importKey(
		'jwk',
		jwk,
		{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
		false,
		['verify'],
	);
	const valid = await crypto.subtle.verify(
		'RSASSA-PKCS1-v1_5',
		key,
		base64UrlToBytes(signatureSegment),
		new TextEncoder().encode(`${headerSegment}.${payloadSegment}`),
	);
	if (!valid) {
		return null;
	}

	const now = Math.floor(Date.now() / 1000);
	if (typeof payload.exp !== 'number' || payload.exp < now) {
		return null;
	}
	if (typeof payload.iat !== 'number' || payload.iat > now + 60) {
		return null;
	}
	if (payload.aud !== projectId) {
		return null;
	}
	if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
		return null;
	}
	if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
		return null;
	}

	return {
		uid: payload.sub,
		email: payload.email,
		emailVerified: payload.email_verified === true,
		signInProvider: payload.firebase?.sign_in_provider,
		raw: payload,
	};
}
