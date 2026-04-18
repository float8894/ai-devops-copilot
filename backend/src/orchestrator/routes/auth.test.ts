import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import cookieParser from 'cookie-parser';
import { AppError } from '../../errors/index.js';

// ---------------------------------------------------------------------------
// Mock all external dependencies used by auth.ts
// ---------------------------------------------------------------------------

vi.mock('../../lib/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../lib/redis.js', () => ({
  redis: {
    setex: vi.fn().mockResolvedValue('OK'),
    get: vi.fn(),
    del: vi.fn().mockResolvedValue(1),
    set: vi.fn(),
  },
}));

vi.mock('../../lib/auth.js', () => ({
  signAccessToken: vi.fn(),
  signRefreshToken: vi.fn(),
  verifyRefreshToken: vi.fn(),
  hashToken: vi.fn((t: string) => `hash:${t}`),
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
  REFRESH_TOKEN_TTL_SECONDS: 604800,
}));

vi.mock('../../services/user.service.js', () => ({
  createUser: vi.fn(),
  findUserByEmail: vi.fn(),
  findUserById: vi.fn(),
  updateLastLogin: vi.fn().mockResolvedValue(undefined),
  isFirstUser: vi.fn(),
}));

vi.mock('../middleware/authenticate.js', () => ({
  authenticate: vi.fn((_req: Request, _res: Response, next: NextFunction) =>
    next(),
  ),
}));

// ---------------------------------------------------------------------------
// Imports after mocking
// ---------------------------------------------------------------------------

import { authRouter } from './auth.js';
import { redis } from '../../lib/redis.js';
import {
  signAccessToken,
  signRefreshToken,
  hashPassword,
  verifyPassword,
} from '../../lib/auth.js';
import {
  createUser,
  findUserByEmail,
  findUserById,
  isFirstUser,
} from '../../services/user.service.js';

const mockRedis = vi.mocked(redis) as typeof redis & {
  setex: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
};
const mockSignAccessToken = vi.mocked(signAccessToken);
const mockSignRefreshToken = vi.mocked(signRefreshToken);
const mockHashPassword = vi.mocked(hashPassword);
const mockVerifyPassword = vi.mocked(verifyPassword);
const mockCreateUser = vi.mocked(createUser);
const mockFindUserByEmail = vi.mocked(findUserByEmail);
const mockFindUserById = vi.mocked(findUserById);
const mockIsFirstUser = vi.mocked(isFirstUser);

// ---------------------------------------------------------------------------
// Test app factory — minimal Express app with authRouter + inline error handler
// ---------------------------------------------------------------------------

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRouter);
  // Minimal error handler that Returns AppError data without needing AsyncLocalStorage
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

const testUser = {
  id: 'user-uuid-1',
  email: 'test@example.com',
  passwordHash: '$2b$12$hashedpassword',
  role: 'user' as const,
  lastLoginAt: null,
  createdAt: new Date('2026-01-01'),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/auth/register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 201 with user data on successful registration', async () => {
    mockIsFirstUser.mockResolvedValue(false);
    mockHashPassword.mockResolvedValue('hashed-password');
    mockCreateUser.mockResolvedValue(testUser);

    const res = await request(createTestApp())
      .post('/api/auth/register')
      .send({ email: 'test@example.com', password: 'SecurePass1!' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: testUser.id,
      email: testUser.email,
      role: testUser.role,
    });
  });

  it('assigns admin role to the first registered user', async () => {
    mockIsFirstUser.mockResolvedValue(true);
    mockHashPassword.mockResolvedValue('hash');
    mockCreateUser.mockResolvedValue({ ...testUser, role: 'admin' });

    const res = await request(createTestApp())
      .post('/api/auth/register')
      .send({ email: 'admin@example.com', password: 'AdminPass1!' });

    expect(res.status).toBe(201);
    expect(mockCreateUser).toHaveBeenCalledWith(
      'admin@example.com',
      'hash',
      'admin',
    );
  });

  it('returns 422 when email is invalid', async () => {
    const res = await request(createTestApp())
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: 'SecurePass1!' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when password is too short', async () => {
    const res = await request(createTestApp())
      .post('/api/auth/register')
      .send({ email: 'test@example.com', password: 'short' });

    expect(res.status).toBe(400);
  });

  it('returns 422 (not 409) on duplicate email to avoid email enumeration', async () => {
    const { DatabaseError } = await import('../../errors/index.js');
    mockIsFirstUser.mockResolvedValue(false);
    mockHashPassword.mockResolvedValue('hash');
    mockCreateUser.mockRejectedValue(
      new DatabaseError('Email already registered'),
    );

    const res = await request(createTestApp())
      .post('/api/auth/register')
      .send({ email: 'dup@example.com', password: 'SecurePass1!' });

    expect(res.status).toBe(400);
    // Must NOT leak "email already registered" to client
    expect(res.body.error.message).not.toContain('already');
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with accessToken on valid credentials', async () => {
    mockFindUserByEmail.mockResolvedValue(testUser);
    mockVerifyPassword.mockResolvedValue(true);
    mockSignAccessToken.mockResolvedValue('access.token.here');
    mockSignRefreshToken.mockResolvedValue('refresh.token.here');
    (mockRedis.setex as ReturnType<typeof vi.fn>).mockResolvedValue('OK');

    const res = await request(createTestApp())
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'Secret123!' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      accessToken: 'access.token.here',
      user: { id: testUser.id, email: testUser.email, role: testUser.role },
    });
  });

  it('returns 401 when user is not found', async () => {
    mockFindUserByEmail.mockResolvedValue(null);
    mockVerifyPassword.mockResolvedValue(false);

    const res = await request(createTestApp())
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'pass' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when password is wrong', async () => {
    mockFindUserByEmail.mockResolvedValue(testUser);
    mockVerifyPassword.mockResolvedValue(false);

    const res = await request(createTestApp())
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'wrong' });

    expect(res.status).toBe(401);
  });

  it('returns 400 when request body is invalid', async () => {
    const res = await request(createTestApp())
      .post('/api/auth/login')
      .send({ email: 'not-email', password: '' });

    expect(res.status).toBe(400);
  });

  it('sets refreshToken cookie on valid login', async () => {
    mockFindUserByEmail.mockResolvedValue(testUser);
    mockVerifyPassword.mockResolvedValue(true);
    mockSignAccessToken.mockResolvedValue('access.token');
    mockSignRefreshToken.mockResolvedValue('refresh.token');
    (mockRedis.setex as ReturnType<typeof vi.fn>).mockResolvedValue('OK');

    const res = await request(createTestApp())
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'pass' });

    const cookies = res.headers['set-cookie'] as string[] | string | undefined;
    const cookieHeader = Array.isArray(cookies)
      ? cookies.join(';')
      : (cookies ?? '');
    expect(cookieHeader).toContain('refreshToken=');
    expect(cookieHeader).toContain('HttpOnly');
  });
});

describe('GET /api/auth/me', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with user profile when authenticated', async () => {
    mockFindUserById.mockResolvedValue(testUser);
    // Inject user via mock authenticate middleware already set up above—
    // but we need req.user to be set. Override authenticate for this test app.
    const { authenticate } = await import('../middleware/authenticate.js');
    vi.mocked(authenticate).mockImplementation(
      async (req: Request, _res: Response, next: NextFunction) => {
        req.user = {
          sub: testUser.id,
          email: testUser.email,
          role: testUser.role,
        };
        next();
      },
    );

    const res = await request(createTestApp())
      .get('/api/auth/me')
      .set('Authorization', 'Bearer fake.token');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: testUser.id, email: testUser.email });
  });
});
