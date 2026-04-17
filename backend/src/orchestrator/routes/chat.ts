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
import {
  getDefaultAccount,
  getAccountById,
} from '../../services/aws-account.service.js';
import { assumeRole } from '../../lib/sts.js';
import type { AssumedCredentials } from '../../lib/sts.js';

export const chatRouter = Router();

const log = createLogger({ service: 'chat-route' });

const ChatRequestSchema = z.object({
  message: z
    .string()
    .min(1, 'Message cannot be empty')
    .max(2000, 'Message too long'),
  conversationId: z.string().uuid().optional(),
  awsAccountId: z.string().uuid().optional(),
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

async function resolveAwsCredentials(
  userId: string,
  accountId?: string,
): Promise<AssumedCredentials | undefined> {
  const account = accountId
    ? await getAccountById(userId, accountId)
    : await getDefaultAccount(userId);

  if (!account) return undefined;

  return assumeRole(account.roleArn, userId, account.id);
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

      const { message, conversationId, awsAccountId } = parsed.data;
      const userId = req.user!.sub;

      log.info(
        { message_length: message.length, conversationId },
        'Chat request received',
      );

      const awsCredentials = await resolveAwsCredentials(userId, awsAccountId);
      const result = await runCopilotQuery(
        message,
        userId,
        conversationId,
        awsCredentials,
      );

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

      const { message, conversationId, awsAccountId } = parsed.data;
      const userId = req.user!.sub;

      log.info(
        { message_length: message.length, conversationId },
        'Stream request received',
      );

      const awsCredentials = await resolveAwsCredentials(userId, awsAccountId);

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
        userId,
        (event) => {
          if (closed) return;
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        },
        conversationId,
        awsCredentials,
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
