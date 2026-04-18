import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../lib/auth.js', () => ({
  verifyAccessToken: vi.fn(),
}));

import { authenticate } from './authenticate.js';
import { verifyAccessToken } from '../../lib/auth.js';
import { AuthError } from '../../errors/index.js';
import type { Request, Response, NextFunction } from 'express';
import type { TokenPayload } from '../../lib/auth.js';

const mockVerifyAccessToken = vi.mocked(verifyAccessToken);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(authHeader?: string): Partial<Request> {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
  };
}

function makeRes(): Partial<Response> {
  return {};
}

function makeNext(): ReturnType<typeof vi.fn> {
  return vi.fn();
}

const fakePayload: TokenPayload = {
  sub: 'user-id-123',
  email: 'test@example.com',
  role: 'user',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('authenticate middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets req.user and calls next() with no args on valid Bearer token', async () => {
    mockVerifyAccessToken.mockResolvedValue(fakePayload);

    const req = makeReq('Bearer valid.jwt.token') as Request;
    const next = makeNext() as unknown as NextFunction;

    await authenticate(req, makeRes() as Response, next);

    expect(mockVerifyAccessToken).toHaveBeenCalledWith('valid.jwt.token');
    expect(req.user).toEqual(fakePayload);
    expect(next).toHaveBeenCalledWith(); // called with no arguments = no error
  });

  it('calls next(AuthError) when Authorization header is missing', async () => {
    const req = makeReq() as Request;
    const next = makeNext() as unknown as NextFunction;

    await authenticate(req, makeRes() as Response, next);

    const err = vi.mocked(next).mock.calls[0]?.[0];
    expect(err).toBeInstanceOf(AuthError);
  });

  it('calls next(AuthError) when Authorization header does not start with Bearer', async () => {
    const req = makeReq('Basic abc123') as Request;
    const next = makeNext() as unknown as NextFunction;

    await authenticate(req, makeRes() as Response, next);

    const err = vi.mocked(next).mock.calls[0]?.[0];
    expect(err).toBeInstanceOf(AuthError);
  });

  it('calls next(AuthError) when verifyAccessToken throws a generic error', async () => {
    mockVerifyAccessToken.mockRejectedValue(new Error('jwt malformed'));

    const req = makeReq('Bearer bad.token') as Request;
    const next = makeNext() as unknown as NextFunction;

    await authenticate(req, makeRes() as Response, next);

    const err = vi.mocked(next).mock.calls[0]?.[0];
    expect(err).toBeInstanceOf(AuthError);
  });

  it('passes the original AuthError through (not double-wrapped)', async () => {
    const originalErr = new AuthError('Token has been revoked');
    mockVerifyAccessToken.mockRejectedValue(originalErr);

    const req = makeReq('Bearer revoked.token') as Request;
    const next = makeNext() as unknown as NextFunction;

    await authenticate(req, makeRes() as Response, next);

    const err = vi.mocked(next).mock.calls[0]?.[0];
    expect(err).toBe(originalErr); // same instance — not wrapped again
  });

  it('extracts the token without the "Bearer " prefix', async () => {
    mockVerifyAccessToken.mockResolvedValue(fakePayload);

    const req = makeReq('Bearer my.actual.token') as Request;
    await authenticate(
      req,
      makeRes() as Response,
      vi.fn() as unknown as NextFunction,
    );

    expect(mockVerifyAccessToken).toHaveBeenCalledWith('my.actual.token');
  });
});
