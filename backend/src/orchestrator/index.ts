import express, { type Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createLogger } from '../lib/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import {
  generalRateLimiter,
  chatRateLimiter,
} from './middleware/rate-limit.js';
import { chatRouter } from './routes/chat.js';
import { env } from '../config/env.js';

const log = createLogger({ service: 'app' });

interface RequestContext {
  requestId: string;
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

  // Request size limits
  app.use(
    express.json({
      limit: '10kb',
    }),
  );
  app.use(
    express.urlencoded({
      extended: true,
      limit: '10kb',
    }),
  );

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

  // Health check — no rate limiting
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Chat endpoint — stricter rate limiting
  app.use('/api/chat', chatRateLimiter, chatRouter);

  // Centralized error handler — must be last
  app.use(errorHandler);

  return app;
}
