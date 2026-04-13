import { type Request, type Response, type NextFunction } from 'express';
import { AppError } from '../../errors/index.js';
import { createLogger } from '../../lib/logger.js';
import { requestContext } from '../index.js';

const log = createLogger({ service: 'error-handler' });

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const ctx = requestContext.getStore();
  const requestId = ctx?.requestId;

  if (err instanceof AppError) {
    log.warn({ err, requestId, code: err.code }, 'Application error');
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, requestId },
    });
    return;
  }

  log.error({ err, requestId }, 'Unexpected error');
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      requestId,
    },
  });
}
