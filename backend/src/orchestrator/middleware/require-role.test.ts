import { vi, describe, it, expect } from 'vitest';

// require-role only uses type-only imports from user.service.js (erased at runtime)
// and concrete imports from errors/index.js — no env.ts dependency, no mocks needed

import { requireRole } from './require-role.js';
import { AuthError, ForbiddenError } from '../../errors/index.js';
import type { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// Helpers — minimal mock request with optional req.user
// ---------------------------------------------------------------------------

function makeReq(user?: { sub: string; email: string; role: string }): Request {
  const base: Record<string, unknown> = {};
  if (user !== undefined) base['user'] = user;
  return base as unknown as Request;
}

function makeNext(): ReturnType<typeof vi.fn> {
  return vi.fn();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('requireRole middleware', () => {
  it('calls next() with no args when user has the required role', () => {
    const middleware = requireRole('admin');
    const next = makeNext() as unknown as NextFunction;

    middleware(
      makeReq({ sub: 'u1', email: 'a@b.com', role: 'admin' }) as Request,
      {} as Response,
      next,
    );

    expect(next).toHaveBeenCalledWith(); // no error
  });

  it('calls next() when user has one of multiple allowed roles', () => {
    const middleware = requireRole('user', 'admin');
    const next = makeNext() as unknown as NextFunction;

    middleware(
      makeReq({ sub: 'u1', email: 'a@b.com', role: 'user' }) as Request,
      {} as Response,
      next,
    );

    expect(next).toHaveBeenCalledWith();
  });

  it('calls next(ForbiddenError) when user has wrong role', () => {
    const middleware = requireRole('admin');
    const next = makeNext() as unknown as NextFunction;

    middleware(
      makeReq({ sub: 'u1', email: 'a@b.com', role: 'user' }) as Request,
      {} as Response,
      next,
    );

    const err = vi.mocked(next).mock.calls[0]?.[0];
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it('ForbiddenError message lists required roles', () => {
    const middleware = requireRole('admin');
    const next = makeNext() as unknown as NextFunction;

    middleware(
      makeReq({ sub: 'u1', email: 'a@b.com', role: 'user' }) as Request,
      {} as Response,
      next,
    );

    const err = vi.mocked(next).mock.calls[0]?.[0] as unknown as ForbiddenError;
    expect(err.message).toContain('admin');
  });

  it('calls next(AuthError) when req.user is not set', () => {
    const middleware = requireRole('admin');
    const next = makeNext() as unknown as NextFunction;

    middleware(makeReq() as Request, {} as Response, next);

    const err = vi.mocked(next).mock.calls[0]?.[0];
    expect(err).toBeInstanceOf(AuthError);
  });

  it('returns a new middleware function each invocation', () => {
    const m1 = requireRole('admin');
    const m2 = requireRole('user');
    expect(m1).not.toBe(m2);
  });
});
