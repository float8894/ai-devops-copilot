import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import { z } from 'zod';
import { ValidationError } from '../../errors/index.js';
import { runCopilotQuery, runCopilotQueryStream } from '../claude.js';
import { createLogger } from '../../lib/logger.js';

export const chatRouter = Router();

const log = createLogger({ service: 'chat-route' });

const ChatRequestSchema = z.object({
  message: z
    .string()
    .min(1, 'Message cannot be empty')
    .max(2000, 'Message too long'),
  conversationId: z.string().uuid().optional(),
});

type ChatRequestBody = z.infer<typeof ChatRequestSchema>;

interface ChatResponseBody {
  reply: string;
  toolsUsed: string[];
  conversationId: string;
}

interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
  };
}

chatRouter.post(
  '/',
  async (
    req: Request<object, ChatResponseBody | ErrorResponseBody, ChatRequestBody>,
    res: Response<ChatResponseBody | ErrorResponseBody>,
    next: NextFunction,
  ) => {
    try {
      const parsed = ChatRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError('Invalid request body', parsed.error);
      }

      const { message, conversationId } = parsed.data;

      log.info(
        { message_length: message.length, conversationId },
        'Chat request received',
      );

      const result = await runCopilotQuery(message, conversationId);

      log.info(
        {
          tools_used: result.toolsUsed,
          conversation_id: result.conversationId,
        },
        'Chat request completed',
      );

      res.json({
        reply: result.reply,
        toolsUsed: result.toolsUsed,
        conversationId: result.conversationId,
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/chat/stream — SSE streaming endpoint
chatRouter.post(
  '/stream',
  async (
    req: Request<object, unknown, ChatRequestBody>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const parsed = ChatRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError('Invalid request body', parsed.error);
      }

      const { message, conversationId } = parsed.data;

      log.info(
        { message_length: message.length, conversationId },
        'Stream request received',
      );

      // SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      let closed = false;
      req.on('close', () => {
        closed = true;
      });

      await runCopilotQueryStream(
        message,
        (event) => {
          if (closed) return;
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        },
        conversationId,
      );

      if (!closed) {
        res.end();
      }

      log.info({ conversationId }, 'Stream request completed');
    } catch (err) {
      next(err);
    }
  },
);
