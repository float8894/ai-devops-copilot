import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { createLogger } from '../../lib/logger.js';
import { ValidationError, NotFoundError } from '../../errors/index.js';
import { authenticate } from '../middleware/authenticate.js';
import {
  addAccount,
  listAccounts,
  deleteAccount,
} from '../../services/aws-account.service.js';

export const awsAccountsRouter = Router();

const log = createLogger({ service: 'aws-accounts-route' });

// Role ARN format: arn:aws:iam::123456789012:role/RoleName
const ROLE_ARN_RE = /^arn:aws:iam::\d{12}:role\/[\w+=,.@/-]{1,64}$/;

const AddAccountSchema = z.object({
  name: z.string().min(1).max(100),
  roleArn: z.string().regex(ROLE_ARN_RE, 'Invalid IAM Role ARN format'),
  makeDefault: z.boolean().optional().default(false),
});

// All routes require authentication
awsAccountsRouter.use(authenticate);

// GET /api/aws-accounts
awsAccountsRouter.get(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const accounts = await listAccounts(userId);
      res.json({ accounts });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/aws-accounts
awsAccountsRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = AddAccountSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError('Invalid account data', parsed.error);
      }

      const userId = req.user!.sub;
      const { name, roleArn, makeDefault } = parsed.data;

      const account = await addAccount(userId, name, roleArn, makeDefault);

      log.info({ userId, accountId: account.id }, 'AWS account added via API');

      res.status(201).json({ account });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/aws-accounts/:id
awsAccountsRouter.delete(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const accountId = req.params['id'] as string | undefined;

      if (!accountId) throw new NotFoundError('Account ID required');

      await deleteAccount(userId, accountId);

      log.info({ userId, accountId }, 'AWS account deleted via API');

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);
