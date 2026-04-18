import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { AppError } from '../../errors/index.js';

// ---------------------------------------------------------------------------
// Mock dependencies used by chat.ts route
// ---------------------------------------------------------------------------

vi.mock('../../lib/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('../claude.js', () => ({
  runCopilotQuery: vi.fn(),
  runCopilotQueryStream: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports after mocking
// ---------------------------------------------------------------------------

import { chatRouter } from './chat.js';
import { runCopilotQuery } from '../claude.js';

const mockRunCopilotQuery = vi.mocked(runCopilotQuery);

// ---------------------------------------------------------------------------
// Test app factory
// ---------------------------------------------------------------------------

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/chat', chatRouter);
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
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with reply, toolsUsed, and conversationId', async () => {
    mockRunCopilotQuery.mockResolvedValue({
      reply: 'No failed jobs in the last 24h.',
      toolsUsed: ['query_failed_jobs'],
      conversationId: 'conv-uuid-1',
    });

    const res = await request(createTestApp())
      .post('/api/chat')
      .send({ message: 'Any failed jobs today?' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      reply: 'No failed jobs in the last 24h.',
      toolsUsed: ['query_failed_jobs'],
      conversationId: 'conv-uuid-1',
    });
  });

  it('passes message to runCopilotQuery', async () => {
    mockRunCopilotQuery.mockResolvedValue({
      reply: 'ok',
      toolsUsed: [],
      conversationId: 'c1',
    });

    await request(createTestApp())
      .post('/api/chat')
      .send({ message: 'Are costs high?' });

    expect(mockRunCopilotQuery).toHaveBeenCalledWith(
      'Are costs high?',
      undefined, // conversationId — not provided
    );
  });

  it('returns 400 when message is empty', async () => {
    const res = await request(createTestApp())
      .post('/api/chat')
      .send({ message: '' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockRunCopilotQuery).not.toHaveBeenCalled();
  });

  it('returns 400 when message is missing', async () => {
    const res = await request(createTestApp()).post('/api/chat').send({});

    expect(res.status).toBe(400);
  });

  it('returns 400 when message exceeds 2000 chars', async () => {
    const res = await request(createTestApp())
      .post('/api/chat')
      .send({ message: 'x'.repeat(2001) });

    expect(res.status).toBe(400);
  });

  it('forwards conversationId to runCopilotQuery when provided', async () => {
    const convId = 'a1b2c3d4-e5f6-4789-ab01-b34567890abc';
    mockRunCopilotQuery.mockResolvedValue({
      reply: 'sure',
      toolsUsed: [],
      conversationId: convId,
    });

    await request(createTestApp())
      .post('/api/chat')
      .send({ message: 'follow up question', conversationId: convId });

    expect(mockRunCopilotQuery).toHaveBeenCalledWith(
      'follow up question',
      convId,
    );
  });
});
