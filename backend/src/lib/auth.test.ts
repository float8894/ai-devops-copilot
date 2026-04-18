import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must mock env before importing auth (env.ts runs at import time)
vi.mock('../config/env.js', () => ({
  env: {
    JWT_SECRET: 'test-jwt-secret-that-is-at-least-32-characters',
    JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-at-least-32-chars',
    ANTHROPIC_API_KEY: 'sk-ant-test',
    DATABASE_URL: 'postgresql://localhost/test',
    REDIS_URL: 'redis://localhost',
    AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'AKIATEST',
    AWS_SECRET_ACCESS_KEY: 'testsecret',
    ALLOWED_ORIGIN: 'http://localhost:4200',
    NODE_ENV: 'test',
    PORT: 3000,
    MCP_POSTGRES_HTTP_PORT: 3001,
    MCP_REDIS_HTTP_PORT: 3002,
    MCP_AWS_HTTP_PORT: 3003,
  },
}));

import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  hashPassword,
  verifyPassword,
  hashToken,
  REFRESH_TOKEN_TTL_SECONDS,
} from './auth.js';
import { AuthError } from '../errors/index.js';

describe('signAccessToken / verifyAccessToken', () => {
  it('signs and verifies a valid token', async () => {
    const token = await signAccessToken({
      sub: 'user-123',
      email: 'test@example.com',
      role: 'user',
    });
    expect(typeof token).toBe('string');

    const payload = await verifyAccessToken(token);
    expect(payload.sub).toBe('user-123');
    expect(payload.email).toBe('test@example.com');
    expect(payload.role).toBe('user');
  });

  it('throws AuthError for a tampered token', async () => {
    const token = await signAccessToken({
      sub: 'user-123',
      email: 'test@example.com',
      role: 'user',
    });
    await expect(verifyAccessToken(token + 'tampered')).rejects.toBeInstanceOf(
      AuthError,
    );
  });

  it('throws AuthError for a token signed with wrong secret', async () => {
    // Build a token manually with wrong secret
    const { SignJWT } = await import('jose');
    const badSecret = new TextEncoder().encode(
      'wrong-secret-value-here-padding-ok',
    );
    const badToken = await new SignJWT({ email: 'x@x.com', role: 'user' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-999')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(badSecret);

    await expect(verifyAccessToken(badToken)).rejects.toBeInstanceOf(AuthError);
  });
});

describe('signRefreshToken / verifyRefreshToken', () => {
  it('signs and verifies a refresh token returning userId', async () => {
    const token = await signRefreshToken('user-456');
    const userId = await verifyRefreshToken(token);
    expect(userId).toBe('user-456');
  });

  it('throws AuthError for invalid refresh token', async () => {
    await expect(
      verifyRefreshToken('not.a.valid.token'),
    ).rejects.toBeInstanceOf(AuthError);
  });
});

describe('REFRESH_TOKEN_TTL_SECONDS', () => {
  it('equals 7 days in seconds', () => {
    expect(REFRESH_TOKEN_TTL_SECONDS).toBe(7 * 24 * 60 * 60);
  });
});

describe('hashToken', () => {
  it('returns a 64-char hex string (SHA-256)', () => {
    const hash = hashToken('my-raw-token');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic', () => {
    expect(hashToken('same-token')).toBe(hashToken('same-token'));
  });

  it('produces different hashes for different inputs', () => {
    expect(hashToken('token-a')).not.toBe(hashToken('token-b'));
  });
});

describe('hashPassword / verifyPassword', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('super-secret-123');
    expect(typeof hash).toBe('string');
    expect(hash).not.toBe('super-secret-123');

    const valid = await verifyPassword('super-secret-123', hash);
    expect(valid).toBe(true);
  });

  it('returns false for wrong password', async () => {
    const hash = await hashPassword('correct-password');
    const valid = await verifyPassword('wrong-password', hash);
    expect(valid).toBe(false);
  });
}, 15000); // bcrypt is intentionally slow
