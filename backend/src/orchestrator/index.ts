import express, { type Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createLogger } from '../lib/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { generalRateLimiter, chatRateLimiter, authRateLimiter } from './middleware/rate-limit.js';
import { authenticate } from './middleware/authenticate.js';
import { chatRouter } from './routes/chat.js';
import { authRouter } from './routes/auth.js';
import { awsAccountsRouter } from './routes/aws-accounts.js';
import { env } from '../config/env.js';

const log = createLogger({ service: 'app' });

import type { AssumedCredentials } from '../lib/sts.js';

interface RequestContext {
  requestId: string;
  awsCredentials?: AssumedCredentials;
  awsAccountId?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function createApp(): Application {
  const app = express();

  // Security headers
  app.use(helmet());

  // CORS — Angular runs on :4200 in dev, separate origin in prod
  app.use(
    cors({
      origin:
        env.NODE_ENV === 'development'
          ? 'http://localhost:4200'
          : env.ALLOWED_ORIGIN,
      credentials: true,
    }),
  );

  // Cookie parser — needed for httpOnly refresh token cookie
  app.use(cookieParser());

  // Request size limits
  app.use(express.json({ 
    limit: '10kb', // Smaller limit for JSON bodies (was 1mb)
  }));
  app.use(express.urlencoded({ 
    extended: true, 
    limit: '10kb',
  }));

  // Global rate limiter — applies to all routes except /health
  app.use(generalRateLimiter);

  // Attach requestId to every request via AsyncLocalStorage
  app.use((_req, _res, next) => {
    const requestId = randomUUID();
    requestContext.run({ requestId }, next);
  });

  // Structured request logging
  app.use((req, _res, next) => {
    const ctx = requestContext.getStore();
    log.info(
      { requestId: ctx?.requestId, method: req.method, url: req.url },
      'Request received',
    );
    next();
  });

  // Health check — no auth required, no rate limiting
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Auth routes — rate limited, no authentication required
  app.use('/api/auth', authRateLimiter, authRouter);

  // AWS account management — authentication enforced inside router
  app.use('/api/aws-accounts', awsAccountsRouter);

  // Chat endpoint — authentication required + stricter rate limiting
  app.use('/api/chat', authenticate, chatRateLimiter, chatRouter);

  // Centralized error handler — must be last
  app.use(errorHandler);

  return app;
}
