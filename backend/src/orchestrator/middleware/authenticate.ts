import { type Request, type Response, type NextFunction } from 'express';
import { verifyAccessToken, type TokenPayload } from '../../lib/auth.js';
import { AuthError } from '../../errors/index.js';

// Extend Express Request to carry authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AuthError('Missing Authorization header');
    }

    const token = authHeader.slice(7);
    const payload = await verifyAccessToken(token);
    req.user = payload;
    next();
  } catch (err) {
    next(err instanceof AuthError ? err : new AuthError());
  }
}
