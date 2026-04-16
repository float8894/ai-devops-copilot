import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import { z } from 'zod';
import { redis } from '../../lib/redis.js';
import { createLogger } from '../../lib/logger.js';
import {
  ValidationError,
  AuthError,
  DatabaseError,
} from '../../errors/index.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
  hashPassword,
  verifyPassword,
  REFRESH_TOKEN_TTL_SECONDS,
} from '../../lib/auth.js';
import {
  createUser,
  findUserByEmail,
  findUserById,
  updateLastLogin,
  isFirstUser,
} from '../../services/user.service.js';
import { authenticate } from '../middleware/authenticate.js';

export const authRouter = Router();

const log = createLogger({ service: 'auth-route' });

const REFRESH_COOKIE = 'refreshToken';

const RegisterSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password too long'),
});

const LoginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(1, 'Password required'),
});

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
    path: '/api/auth',
  });
}

// POST /api/auth/register
authRouter.post(
  '/register',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = RegisterSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError('Invalid registration data', parsed.error);
      }

      const { email, password } = parsed.data;

      // First registered user becomes admin
      const firstUser = await isFirstUser();
      const role = firstUser ? 'admin' : 'user';

      const passwordHash = await hashPassword(password);
      const user = await createUser(email, passwordHash, role);

      log.info({ userId: user.id, role }, 'User registered');

      res.status(201).json({
        id: user.id,
        email: user.email,
        role: user.role,
      });
    } catch (err) {
      if (
        err instanceof DatabaseError &&
        err.message === 'Email already registered'
      ) {
        // Don't leak whether email exists — return generic conflict
        next(new ValidationError('Registration failed — check your input'));
        return;
      }
      next(err);
    }
  },
);

// POST /api/auth/login
authRouter.post(
  '/login',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = LoginSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError('Invalid login data', parsed.error);
      }

      const { email, password } = parsed.data;
      const user = await findUserByEmail(email);

      // Constant-time path — always call verifyPassword even if user not found
      const dummyHash =
        '$2a$12$invalidsaltinvalidsaltinvalidsaltinvalidsaltinvalidsal';
      const valid =
        user !== null
          ? await verifyPassword(password, user.passwordHash)
          : await verifyPassword(password, dummyHash).then(() => false);

      if (!user || !valid) {
        throw new AuthError('Invalid email or password');
      }

      const accessToken = await signAccessToken({
        sub: user.id,
        email: user.email,
        role: user.role,
      });
      const refreshToken = await signRefreshToken(user.id);
      const tokenHash = hashToken(refreshToken);

      await redis.setex(
        `refresh:${tokenHash}`,
        REFRESH_TOKEN_TTL_SECONDS,
        user.id,
      );

      await updateLastLogin(user.id);

      setRefreshCookie(res, refreshToken);

      log.info({ userId: user.id }, 'User logged in');

      res.json({
        accessToken,
        user: { id: user.id, email: user.email, role: user.role },
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/auth/refresh
authRouter.post(
  '/refresh',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawToken: unknown = req.cookies?.[REFRESH_COOKIE];
      if (typeof rawToken !== 'string' || !rawToken) {
        throw new AuthError('No refresh token');
      }

      const userId = await verifyRefreshToken(rawToken);
      const tokenHash = hashToken(rawToken);
      const storedUserId = await redis.get(`refresh:${tokenHash}`);

      if (storedUserId !== userId) {
        throw new AuthError('Refresh token revoked');
      }

      const user = await findUserById(userId);
      if (!user) throw new AuthError('User not found');

      // Token rotation — issue new pair, invalidate old
      await redis.del(`refresh:${tokenHash}`);

      const accessToken = await signAccessToken({
        sub: user.id,
        email: user.email,
        role: user.role,
      });
      const newRefreshToken = await signRefreshToken(user.id);
      const newHash = hashToken(newRefreshToken);

      await redis.setex(
        `refresh:${newHash}`,
        REFRESH_TOKEN_TTL_SECONDS,
        user.id,
      );

      setRefreshCookie(res, newRefreshToken);

      log.debug({ userId }, 'Tokens refreshed');

      res.json({ accessToken });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/auth/logout
authRouter.post(
  '/logout',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawToken: unknown = req.cookies?.[REFRESH_COOKIE];
      if (typeof rawToken === 'string' && rawToken) {
        const tokenHash = hashToken(rawToken);
        await redis.del(`refresh:${tokenHash}`);
      }

      res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/auth/me — requires valid access token
authRouter.get(
  '/me',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) throw new AuthError();
      const user = await findUserById(req.user.sub);
      if (!user) throw new AuthError('User not found');

      res.json({
        id: user.id,
        email: user.email,
        role: user.role,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
      });
    } catch (err) {
      next(err);
    }
  },
);
