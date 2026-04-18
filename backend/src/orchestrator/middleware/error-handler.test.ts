import { vi, describe, it, expect, beforeEach } from 'vitest';

const { mockGetStore } = vi.hoisted(() => ({
  mockGetStore: vi.fn(),
}));

vi.mock('../index.js', () => ({
  requestContext: {
    getStore: mockGetStore,
  },
}));

vi.mock('../../lib/logger.js', () => ({
  createLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { errorHandler } from './error-handler.js';
import {
  AppError,
  DatabaseError,
  NotFoundError,
  ValidationError,
  McpToolError,
} from '../../errors/index.js';
import type { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(): Partial<Request> {
  return {};
}

function makeRes() {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  return { status, json: vi.fn(), _status: status, _json: json };
}

function makeNext(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('errorHandler middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStore.mockReturnValue(undefined);
  });

  it('returns 500 for unknown (non-AppError) errors', () => {
    const res = makeRes();

    errorHandler(
      new Error('Something broke'),
      makeReq() as Request,
      res as unknown as Response,
      makeNext(),
    );

    expect(res.status).toHaveBeenCalledWith(500);
    const body = res._status.mock.results[0]?.value.json.mock.calls[0]?.[0] as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns 500 for non-Error unknown values (e.g. thrown string)', () => {
    const res = makeRes();

    errorHandler(
      'oops',
      makeReq() as Request,
      res as unknown as Response,
      makeNext(),
    );

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('returns correct statusCode and code for DatabaseError', () => {
    const res = makeRes();

    errorHandler(
      new DatabaseError('DB failed'),
      makeReq() as Request,
      res as unknown as Response,
      makeNext(),
    );

    expect(res.status).toHaveBeenCalledWith(500);
    const body = res._status.mock.results[0]?.value.json.mock.calls[0]?.[0] as {
      error: { code: string };
    };
    expect(body.error.code).toBe('DATABASE_ERROR');
  });

  it('returns 404 for NotFoundError', () => {
    const res = makeRes();

    errorHandler(
      new NotFoundError('Resource missing'),
      makeReq() as Request,
      res as unknown as Response,
      makeNext(),
    );

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 422 for ValidationError', () => {
    const res = makeRes();

    errorHandler(
      new ValidationError('Invalid input'),
      makeReq() as Request,
      res as unknown as Response,
      makeNext(),
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 500 for McpToolError', () => {
    const res = makeRes();

    errorHandler(
      new McpToolError('MCP failed', 'test-tool'),
      makeReq() as Request,
      res as unknown as Response,
      makeNext(),
    );

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('includes requestId from AsyncLocalStorage store in response body', () => {
    mockGetStore.mockReturnValue({ requestId: 'req-abc-123' });
    const res = makeRes();

    errorHandler(
      new AppError('test', 'TEST_CODE', 400),
      makeReq() as Request,
      res as unknown as Response,
      makeNext(),
    );

    const body = res._status.mock.results[0]?.value.json.mock.calls[0]?.[0] as {
      error: { requestId: string };
    };
    expect(body.error.requestId).toBe('req-abc-123');
  });

  it('includes undefined requestId when no store context is set', () => {
    mockGetStore.mockReturnValue(undefined);
    const res = makeRes();

    errorHandler(
      new AppError('test', 'TEST_CODE', 400),
      makeReq() as Request,
      res as unknown as Response,
      makeNext(),
    );

    const body = res._status.mock.results[0]?.value.json.mock.calls[0]?.[0] as {
      error: { requestId: unknown };
    };
    expect(body.error.requestId).toBeUndefined();
  });
});
