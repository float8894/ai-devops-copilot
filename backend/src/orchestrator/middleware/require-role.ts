import { type Request, type Response, type NextFunction } from 'express';
import { type UserRole } from '../../services/user.service.js';
import { ForbiddenError, AuthError } from '../../errors/index.js';

export function requireRole(...roles: UserRole[]) {
  return (_req: Request, _res: Response, next: NextFunction): void => {
    const req = _req;
    if (!req.user) {
      next(new AuthError());
      return;
    }
    if (!roles.includes(req.user.role as UserRole)) {
      next(new ForbiddenError(`Requires role: ${roles.join(' or ')}`));
      return;
    }
    next();
  };
}
