import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../lib/database.js', () => ({
  query: vi.fn(),
}));

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import {
  createUser,
  findUserByEmail,
  findUserById,
  updateLastLogin,
} from './user.service.js';
import { query } from '../lib/database.js';
import { DatabaseError } from '../errors/index.js';
import { makeTestUser } from '../test/helpers.js';

const mockQuery = vi.mocked(query);

describe('user.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // createUser
  // ---------------------------------------------------------------------------

  describe('createUser', () => {
    it('inserts and returns a mapped User', async () => {
      const row = makeTestUser({
        id: 'uuid-1',
        email: 'alice@example.com',
        role: 'admin',
      });
      mockQuery.mockResolvedValue([row]);

      const user = await createUser(
        'alice@example.com',
        row.password_hash,
        'admin',
      );

      expect(mockQuery).toHaveBeenCalledOnce();
      expect(user.id).toBe('uuid-1');
      expect(user.email).toBe('alice@example.com');
      expect(user.role).toBe('admin');
      expect(user.passwordHash).toBe(row.password_hash);
    });

    it('lowercases and trims email before insert', async () => {
      const row = makeTestUser({ email: 'alice@example.com' });
      mockQuery.mockResolvedValue([row]);

      await createUser('  Alice@Example.COM  ', row.password_hash);

      const callArgs = mockQuery.mock.calls[0];
      const params = callArgs?.[1] as unknown[];
      expect(params?.[0]).toBe('alice@example.com');
    });

    it('throws DatabaseError("Email already registered") on pg code 23505', async () => {
      const pgError = Object.assign(new Error('unique violation'), {
        code: '23505',
      });
      mockQuery.mockRejectedValue(pgError);

      await expect(createUser('dup@example.com', 'hash')).rejects.toMatchObject(
        {
          message: 'Email already registered',
        },
      );
      await expect(
        createUser('dup@example.com', 'hash'),
      ).rejects.toBeInstanceOf(DatabaseError);
    });

    it('throws DatabaseError("Failed to create user") on other DB error', async () => {
      mockQuery.mockRejectedValue(new Error('connection lost'));

      await expect(createUser('x@y.com', 'hash')).rejects.toMatchObject({
        message: 'Failed to create user',
      });
      await expect(createUser('x@y.com', 'hash')).rejects.toBeInstanceOf(
        DatabaseError,
      );
    });

    it('throws DatabaseError when insert returns no row', async () => {
      mockQuery.mockResolvedValue([]);

      await expect(createUser('a@b.com', 'hash')).rejects.toThrow(
        DatabaseError,
      );
    });

    it('defaults role to "user" when not specified', async () => {
      const row = makeTestUser({ role: 'user' });
      mockQuery.mockResolvedValue([row]);

      const user = await createUser('test@example.com', 'hash');

      const callArgs = mockQuery.mock.calls[0];
      const params = callArgs?.[1] as unknown[];
      expect(params?.[2]).toBe('user');
      expect(user.role).toBe('user');
    });
  });

  // ---------------------------------------------------------------------------
  // findUserByEmail
  // ---------------------------------------------------------------------------

  describe('findUserByEmail', () => {
    it('returns a mapped User when found', async () => {
      const row = makeTestUser();
      mockQuery.mockResolvedValue([row]);

      const user = await findUserByEmail('test@example.com');

      expect(user).not.toBeNull();
      expect(user?.email).toBe('test@example.com');
      expect(user?.passwordHash).toBe(row.password_hash);
      expect(user?.lastLoginAt).toBeNull();
    });

    it('returns null when user is not found', async () => {
      mockQuery.mockResolvedValue([]);

      const user = await findUserByEmail('nobody@example.com');

      expect(user).toBeNull();
    });

    it('lowercases and trims email in query', async () => {
      mockQuery.mockResolvedValue([]);

      await findUserByEmail('  Alice@Example.COM  ');

      const callArgs = mockQuery.mock.calls[0];
      const params = callArgs?.[1] as unknown[];
      expect(params?.[0]).toBe('alice@example.com');
    });

    it('wraps DB error in DatabaseError', async () => {
      mockQuery.mockRejectedValue(new Error('DB down'));

      await expect(findUserByEmail('x@y.com')).rejects.toBeInstanceOf(
        DatabaseError,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // findUserById
  // ---------------------------------------------------------------------------

  describe('findUserById', () => {
    it('returns a mapped User when found', async () => {
      const row = makeTestUser({ id: 'specific-id' });
      mockQuery.mockResolvedValue([row]);

      const user = await findUserById('specific-id');

      expect(user?.id).toBe('specific-id');
    });

    it('returns null when user is not found', async () => {
      mockQuery.mockResolvedValue([]);

      expect(await findUserById('missing')).toBeNull();
    });

    it('wraps DB error in DatabaseError', async () => {
      mockQuery.mockRejectedValue(new Error('timeout'));

      await expect(findUserById('x')).rejects.toBeInstanceOf(DatabaseError);
    });
  });

  // ---------------------------------------------------------------------------
  // updateLastLogin — non-fatal: must never throw
  // ---------------------------------------------------------------------------

  describe('updateLastLogin', () => {
    it('calls query and resolves without returning a value', async () => {
      mockQuery.mockResolvedValue([]);

      await expect(updateLastLogin('user-1')).resolves.toBeUndefined();
      expect(mockQuery).toHaveBeenCalledOnce();
    });

    it('swallows DB failure — does not throw', async () => {
      mockQuery.mockRejectedValue(new Error('DB unreachable'));

      // Must resolve, not reject — updateLastLogin is non-fatal
      await expect(updateLastLogin('user-1')).resolves.toBeUndefined();
    });
  });
});
