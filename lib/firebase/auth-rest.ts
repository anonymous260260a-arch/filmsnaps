// lib/firebase/auth-rest.ts
// Lightweight Firebase Auth via REST API (no Admin SDK, no jwks-rsa)
// Cloudflare Workers compatible

const FIREBASE_API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY!;
const FIREBASE_PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID!;

const AUTH_BASE = 'https://identitytoolkit.googleapis.com/v1';

export interface DecodedToken {
  uid: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  iss: string;
  aud: string;
  auth_time: number;
  exp: number;
  iat: number;
  sub: string;
  [key: string]: unknown;
}

/** Raw response shape from /accounts:verifySessionCookie */
interface VerifySessionCookieResponse {
  localId: string;
  email?: string;
  emailVerified?: boolean;
  displayName?: string;
  photoUrl?: string;
  iss: string;
  aud: string;
  auth_time: number;
  exp: number;
  iat: number;
  sub: string;
  [key: string]: unknown;
}

/**
 * Create a session cookie from a Firebase ID token.
 * POST /accounts:createSessionCookie
 */
export async function createSessionCookie(
  idToken: string,
  expiresInMs: number = 60 * 60 * 24 * 5 * 1000, // 5 days
): Promise<string> {
  const res = await fetch(
    `${AUTH_BASE}/accounts:createSessionCookie?key=${FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idToken,
        validDuration: String(Math.floor(expiresInMs / 1000)),
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to create session cookie: ${res.status} ${body}`);
  }

  const data = (await res.json()) as { sessionCookie?: string };
  if (!data.sessionCookie) {
    throw new Error('Session cookie not returned by Firebase API');
  }
  return data.sessionCookie;
}

/**
 * Verify a Firebase session cookie.
 * POST /accounts:verifySessionCookie
 */
export async function verifySessionCookie(
  sessionCookie: string,
): Promise<DecodedToken | null> {
  try {
    const res = await fetch(
      `${AUTH_BASE}/accounts:verifySessionCookie?key=${FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionCookie,
          returnSecureToken: true,
        }),
      },
    );

    if (!res.ok) return null;

    const data = (await res.json()) as VerifySessionCookieResponse;

    // Normalize REST API field names to match Admin SDK's DecodedIdToken shape
    return {
      uid: data.localId,
      email: data.email,
      email_verified: data.emailVerified,
      name: data.displayName,
      picture: data.photoUrl,
      iss: data.iss,
      aud: data.aud,
      auth_time: data.auth_time,
      exp: data.exp,
      iat: data.iat,
      sub: data.sub,
    } as DecodedToken;
  } catch {
    return null;
  }
}
