import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { createHash, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { AuthError } from '../errors/index.js';

const BCRYPT_COST = 12;
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';

export interface TokenPayload extends JWTPayload {
  sub: string; // userId
  email: string;
  role: 'user' | 'admin';
}

const accessSecret = new TextEncoder().encode(env.JWT_SECRET);
const refreshSecret = new TextEncoder().encode(env.JWT_REFRESH_SECRET);

// ---------------------------------------------------------------------------
// JWT
// ---------------------------------------------------------------------------

export async function signAccessToken(payload: Omit<TokenPayload, 'iat' | 'exp'>): Promise<string> {
  return new SignJWT({ email: payload.email, role: payload.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(payload.sub))
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(accessSecret);
}

export async function signRefreshToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(REFRESH_TOKEN_TTL)
    .sign(refreshSecret);
}

export async function verifyAccessToken(token: string): Promise<TokenPayload> {
  try {
    const { payload } = await jwtVerify(token, accessSecret);
    return payload as TokenPayload;
  } catch {
    throw new AuthError('Invalid or expired access token');
  }
}

export async function verifyRefreshToken(token: string): Promise<string> {
  try {
    const { payload } = await jwtVerify(token, refreshSecret);
    if (!payload.sub) throw new AuthError('Invalid refresh token');
    return payload.sub;
  } catch {
    throw new AuthError('Invalid or expired refresh token');
  }
}

// ---------------------------------------------------------------------------
// Token hashing — store SHA-256 hash in Redis, never raw token
// ---------------------------------------------------------------------------

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function tokensEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ---------------------------------------------------------------------------
// Refresh token TTL in seconds (7 days)
// ---------------------------------------------------------------------------

export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
