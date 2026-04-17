# Express Patterns — Node 24 + TypeScript

## Redis Client Setup

```typescript
// src/lib/redis.ts
import Redis from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  // Don't crash the app if Redis is down — handle gracefully
  enableOfflineQueue: false,
});

redis.on('error', (err) => {
  logger.error({ err }, 'Redis connection error');
});

redis.on('connect', () => {
  logger.info('Redis connected');
});
```

## App Setup

```typescript
// src/orchestrator/index.ts
import express, { type Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { logger } from '../lib/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { chatRouter } from './routes/chat.js';
import { env } from '../config/env.js';

export const requestContext = new AsyncLocalStorage<{ requestId: string }>();

export function createApp(): Application {
  const app = express();

  app.use(helmet());

  // CORS — required because Angular runs on :4200 and Node on :3000 in development
  // In production, serve Angular from the same origin or configure properly
  app.use(cors({
    origin: env.NODE_ENV === 'development' ? 'http://localhost:4200' : env.ALLOWED_ORIGIN,
    credentials: true,
  }));

  app.use(express.json({ limit: '1mb' }));

  // Attach requestId to every request
  app.use((req, _res, next) => {
    const requestId = randomUUID();
    requestContext.run({ requestId }, next);
  });

  // Request logging
  app.use((req, _res, next) => {
    const ctx = requestContext.getStore();
    logger.info({ requestId: ctx?.requestId, method: req.method, url: req.url }, 'Request received');
    next();
  });

  app.use('/api/chat', chatRouter);

  // Centralized error handler — always last
  app.use(errorHandler);

  return app;
}
```

## Typed Route Handlers

```typescript
// src/orchestrator/routes/chat.ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../errors/index.js';
import { runCopilotQuery } from '../claude.js';

export const chatRouter = Router();

const ChatRequestSchema = z.object({
  message: z.string().min(1).max(2000),
  conversationId: z.string().uuid().optional(),
});

type ChatRequest = z.infer<typeof ChatRequestSchema>;
type ChatResponse = { reply: string; toolsUsed: string[] };

chatRouter.post(
  '/',
  async (
    req: Request<object, ChatResponse, ChatRequest>,
    res: Response<ChatResponse>,
    next: NextFunction
  ) => {
    try {
      const body = ChatRequestSchema.safeParse(req.body);
      if (!body.success) {
        throw new ValidationError('Invalid request body', body.error);
      }
      const result = await runCopilotQuery(body.data.message);
      res.json(result);
    } catch (err) {
      next(err); // Always pass to centralized handler
    }
  }
);
```

## Centralized Error Handler

```typescript
// src/orchestrator/middleware/error-handler.ts
import { type Request, type Response, type NextFunction } from 'express';
import { AppError } from '../../errors/index.js';
import { logger } from '../../lib/logger.js';
import { requestContext } from '../index.js';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const ctx = requestContext.getStore();
  const requestId = ctx?.requestId;

  if (err instanceof AppError) {
    logger.warn({ err, requestId }, 'Application error');
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, requestId },
    });
    return;
  }

  // Unexpected error
  logger.error({ err, requestId }, 'Unexpected error');
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId },
  });
}
```

## Graceful Shutdown

```typescript
// src/index.ts
import { createApp } from './orchestrator/index.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { db } from './lib/database.js';
import { redis } from './lib/redis.js';

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'Server started');
});

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutdown initiated');
  server.close(async () => {
    await db.end();
    await redis.quit();
    logger.info('Shutdown complete');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```
