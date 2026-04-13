import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import { z } from 'zod';
import { ValidationError } from '../../errors/index.js';
import { runCopilotQuery } from '../claude.js';
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
  conversationId?: string;
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

      const result = await runCopilotQuery(message);

      log.info({ tools_used: result.toolsUsed }, 'Chat request completed');

      res.json({
        reply: result.reply,
        toolsUsed: result.toolsUsed,
        ...(conversationId !== undefined && { conversationId }),
      });
    } catch (err) {
      next(err);
    }
  },
);
