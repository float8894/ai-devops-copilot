import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { AppError, NotFoundError } from '../../errors/index.js';

// ---------------------------------------------------------------------------
// Mock dependencies used by aws-accounts.ts route
// ---------------------------------------------------------------------------

vi.mock('../../lib/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../services/aws-account.service.js', () => ({
  addAccount: vi.fn(),
  listAccounts: vi.fn(),
  deleteAccount: vi.fn(),
}));

// Mock authenticate — inject req.user in every request
vi.mock('../middleware/authenticate.js', () => ({
  authenticate: vi.fn((req: Request, _res: Response, next: NextFunction) => {
    req.user = { sub: 'user-uuid-1', email: 'test@example.com', role: 'user' };
    next();
  }),
}));

// ---------------------------------------------------------------------------
// Imports after mocking
// ---------------------------------------------------------------------------

import { awsAccountsRouter } from './aws-accounts.js';
import {
  addAccount,
  listAccounts,
  deleteAccount,
} from '../../services/aws-account.service.js';

const mockAddAccount = vi.mocked(addAccount);
const mockListAccounts = vi.mocked(listAccounts);
const mockDeleteAccount = vi.mocked(deleteAccount);

// ---------------------------------------------------------------------------
// Test app factory
// ---------------------------------------------------------------------------

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/aws-accounts', awsAccountsRouter);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res
        .status(err.statusCode)
        .json({ error: { code: err.code, message: err.message } });
    } else {
      res
        .status(500)
        .json({ error: { code: 'INTERNAL_ERROR', message: 'unexpected' } });
    }
  });
  return app;
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const testAccount = {
  id: 'acc-uuid-1',
  userId: 'user-uuid-1',
  name: 'prod',
  roleArn: 'arn:aws:iam::123456789012:role/MyRole',
  isDefault: true,
  createdAt: new Date('2026-01-01'),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/aws-accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with accounts array', async () => {
    mockListAccounts.mockResolvedValue([testAccount]);

    const res = await request(createTestApp()).get('/api/aws-accounts');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ accounts: [{ id: testAccount.id }] });
    expect(mockListAccounts).toHaveBeenCalledWith('user-uuid-1');
  });

  it('returns empty accounts array when user has none', async () => {
    mockListAccounts.mockResolvedValue([]);

    const res = await request(createTestApp()).get('/api/aws-accounts');

    expect(res.status).toBe(200);
    expect(res.body.accounts).toEqual([]);
  });
});

describe('POST /api/aws-accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 201 with the created account', async () => {
    mockAddAccount.mockResolvedValue(testAccount);

    const res = await request(createTestApp()).post('/api/aws-accounts').send({
      name: 'prod',
      roleArn: 'arn:aws:iam::123456789012:role/MyRole',
      makeDefault: true,
    });

    expect(res.status).toBe(201);
    expect(res.body.account.id).toBe(testAccount.id);
    expect(mockAddAccount).toHaveBeenCalledWith(
      'user-uuid-1',
      'prod',
      'arn:aws:iam::123456789012:role/MyRole',
      true,
    );
  });

  it('returns 422 when roleArn format is invalid', async () => {
    const res = await request(createTestApp())
      .post('/api/aws-accounts')
      .send({ name: 'prod', roleArn: 'not-a-valid-arn' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(createTestApp())
      .post('/api/aws-accounts')
      .send({ roleArn: 'arn:aws:iam::123456789012:role/Role' });

    expect(res.status).toBe(400);
  });

  it('defaults makeDefault to false when omitted', async () => {
    mockAddAccount.mockResolvedValue(testAccount);

    await request(createTestApp())
      .post('/api/aws-accounts')
      .send({ name: 'dev', roleArn: 'arn:aws:iam::123456789012:role/Dev' });

    expect(mockAddAccount).toHaveBeenCalledWith(
      expect.any(String),
      'dev',
      'arn:aws:iam::123456789012:role/Dev',
      false,
    );
  });
});

describe('DELETE /api/aws-accounts/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 204 on successful deletion', async () => {
    mockDeleteAccount.mockResolvedValue(undefined);

    const res = await request(createTestApp()).delete(
      '/api/aws-accounts/acc-uuid-1',
    );

    expect(res.status).toBe(204);
    expect(mockDeleteAccount).toHaveBeenCalledWith('user-uuid-1', 'acc-uuid-1');
  });

  it('returns 404 when account is not found', async () => {
    mockDeleteAccount.mockRejectedValue(
      new NotFoundError('AWS account not found'),
    );

    const res = await request(createTestApp()).delete(
      '/api/aws-accounts/missing-id',
    );

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
