import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { PoolClient } from 'pg';

vi.mock('../lib/database.js', () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock('../lib/sts.js', () => ({
  invalidateStsCache: vi.fn(),
}));

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import {
  addAccount,
  listAccounts,
  getDefaultAccount,
  getAccountById,
  deleteAccount,
} from './aws-account.service.js';
import { query, withTransaction } from '../lib/database.js';
import { invalidateStsCache } from '../lib/sts.js';
import { DatabaseError, NotFoundError } from '../errors/index.js';

const mockQuery = vi.mocked(query);
const mockWithTransaction = vi.mocked(withTransaction);
const mockInvalidateStsCache = vi.mocked(invalidateStsCache);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAccountRow(
  overrides: Partial<{
    id: string;
    user_id: string;
    name: string;
    role_arn: string;
    is_default: boolean;
    created_at: Date;
  }> = {},
) {
  return {
    id: 'acc-id-1',
    user_id: 'user-1',
    name: 'prod',
    role_arn: 'arn:aws:iam::123456789012:role/MyRole',
    is_default: true,
    created_at: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeQueryResult<T>(rows: T[]) {
  return { rows, rowCount: rows.length, command: 'SELECT', oid: 0, fields: [] };
}

describe('aws-account.service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ---------------------------------------------------------------------------
  // addAccount
  // ---------------------------------------------------------------------------

  describe('addAccount', () => {
    it('returns a mapped AwsAccount on success (makeDefault=true)', async () => {
      const row = makeAccountRow({ is_default: true });
      const mockClient = {
        query: vi
          .fn()
          .mockResolvedValueOnce(makeQueryResult([])) // UPDATE unset others
          .mockResolvedValueOnce(makeQueryResult([row])), // INSERT RETURNING
        release: vi.fn(),
      };
      mockWithTransaction.mockImplementation(async (fn) =>
        fn(mockClient as unknown as PoolClient),
      );

      const result = await addAccount('user-1', 'prod', row.role_arn, true);

      expect(result.id).toBe('acc-id-1');
      expect(result.name).toBe('prod');
      expect(result.isDefault).toBe(true);
      expect(result.userId).toBe('user-1');
    });

    it('runs UPDATE to unset other defaults when makeDefault=true', async () => {
      const row = makeAccountRow();
      const mockClient = {
        query: vi
          .fn()
          .mockResolvedValueOnce(makeQueryResult([]))
          .mockResolvedValueOnce(makeQueryResult([row])),
        release: vi.fn(),
      };
      mockWithTransaction.mockImplementation(async (fn) =>
        fn(mockClient as unknown as PoolClient),
      );

      await addAccount('user-1', 'prod', row.role_arn, true);

      // First call is the UPDATE to set all existing accounts is_default=false
      const firstCallSql = mockClient.query.mock.calls[0]?.[0] as string;
      expect(firstCallSql).toMatch(/UPDATE aws_accounts/i);
    });

    it('auto-defaults when first account (makeDefault=false, count=0)', async () => {
      const row = makeAccountRow({ is_default: true });
      const mockClient = {
        query: vi
          .fn()
          .mockResolvedValueOnce(makeQueryResult([{ count: '0' }])) // COUNT
          .mockResolvedValueOnce(makeQueryResult([row])), // INSERT
        release: vi.fn(),
      };
      mockWithTransaction.mockImplementation(async (fn) =>
        fn(mockClient as unknown as PoolClient),
      );

      const result = await addAccount('user-1', 'first', row.role_arn, false);

      expect(result.isDefault).toBe(true);
      // The INSERT must have been called with is_default=true
      const insertCallParams = mockClient.query.mock.calls[1]?.[1] as unknown[];
      expect(insertCallParams?.[3]).toBe(true);
    });

    it('does not auto-default when existing accounts exist (count>0)', async () => {
      const row = makeAccountRow({ is_default: false });
      const mockClient = {
        query: vi
          .fn()
          .mockResolvedValueOnce(makeQueryResult([{ count: '3' }])) // COUNT
          .mockResolvedValueOnce(makeQueryResult([row])), // INSERT
        release: vi.fn(),
      };
      mockWithTransaction.mockImplementation(async (fn) =>
        fn(mockClient as unknown as PoolClient),
      );

      const result = await addAccount(
        'user-1',
        'secondary',
        row.role_arn,
        false,
      );

      expect(result.isDefault).toBe(false);
      const insertCallParams = mockClient.query.mock.calls[1]?.[1] as unknown[];
      expect(insertCallParams?.[3]).toBe(false);
    });

    it('throws DatabaseError when INSERT returns no row', async () => {
      const mockClient = {
        query: vi
          .fn()
          .mockResolvedValueOnce(makeQueryResult([])) // UPDATE
          .mockResolvedValueOnce(makeQueryResult([])), // INSERT returns empty
        release: vi.fn(),
      };
      mockWithTransaction.mockImplementation(async (fn) =>
        fn(mockClient as unknown as PoolClient),
      );

      await expect(
        addAccount('user-1', 'prod', 'arn:...', true),
      ).rejects.toBeInstanceOf(DatabaseError);
    });
  });

  // ---------------------------------------------------------------------------
  // listAccounts
  // ---------------------------------------------------------------------------

  describe('listAccounts', () => {
    it('returns all accounts for the user as mapped objects', async () => {
      const rows = [
        makeAccountRow({ id: 'a1', is_default: true }),
        makeAccountRow({ id: 'a2', is_default: false }),
      ];
      mockQuery.mockResolvedValue(rows);

      const accounts = await listAccounts('user-1');

      expect(accounts).toHaveLength(2);
      expect(accounts[0]?.id).toBe('a1');
      expect(accounts[0]?.isDefault).toBe(true);
      expect(accounts[1]?.id).toBe('a2');
    });

    it('returns empty array when user has no accounts', async () => {
      mockQuery.mockResolvedValue([]);

      expect(await listAccounts('user-1')).toEqual([]);
    });

    it('wraps DB error in DatabaseError', async () => {
      mockQuery.mockRejectedValue(new Error('DB down'));

      await expect(listAccounts('user-1')).rejects.toBeInstanceOf(
        DatabaseError,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // getDefaultAccount
  // ---------------------------------------------------------------------------

  describe('getDefaultAccount', () => {
    it('returns the default account when one exists', async () => {
      const row = makeAccountRow({ is_default: true });
      mockQuery.mockResolvedValue([row]);

      const account = await getDefaultAccount('user-1');

      expect(account).not.toBeNull();
      expect(account?.isDefault).toBe(true);
    });

    it('returns null when no default account exists', async () => {
      mockQuery.mockResolvedValue([]);

      expect(await getDefaultAccount('user-1')).toBeNull();
    });

    it('wraps DB error in DatabaseError', async () => {
      mockQuery.mockRejectedValue(new Error('timeout'));

      await expect(getDefaultAccount('user-1')).rejects.toBeInstanceOf(
        DatabaseError,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // getAccountById
  // ---------------------------------------------------------------------------

  describe('getAccountById', () => {
    it('returns the account when found for the given user', async () => {
      const row = makeAccountRow({ id: 'acc-123' });
      mockQuery.mockResolvedValue([row]);

      const account = await getAccountById('user-1', 'acc-123');

      expect(account?.id).toBe('acc-123');
    });

    it('returns null when not found', async () => {
      mockQuery.mockResolvedValue([]);

      expect(await getAccountById('user-1', 'missing')).toBeNull();
    });

    it('passes userId and accountId to enforce ownership', async () => {
      mockQuery.mockResolvedValue([]);

      await getAccountById('owner-user', 'target-account');

      const callArgs = mockQuery.mock.calls[0];
      const params = callArgs?.[1] as unknown[];
      expect(params).toContain('owner-user');
      expect(params).toContain('target-account');
    });

    it('wraps DB error in DatabaseError', async () => {
      mockQuery.mockRejectedValue(new Error('fail'));

      await expect(getAccountById('u', 'a')).rejects.toBeInstanceOf(
        DatabaseError,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // deleteAccount
  // ---------------------------------------------------------------------------

  describe('deleteAccount', () => {
    it('deletes the account and invalidates STS cache', async () => {
      const row = makeAccountRow();
      mockQuery
        .mockResolvedValueOnce([row]) // getAccountById → SELECT
        .mockResolvedValueOnce([]); // DELETE
      mockInvalidateStsCache.mockResolvedValue(undefined);

      await deleteAccount('user-1', 'acc-id-1');

      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockInvalidateStsCache).toHaveBeenCalledOnce();
      expect(mockInvalidateStsCache).toHaveBeenCalledWith('user-1', 'acc-id-1');
    });

    it('throws NotFoundError when account does not exist', async () => {
      mockQuery.mockResolvedValue([]); // getAccountById returns null

      await expect(
        deleteAccount('user-1', 'missing-id'),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(deleteAccount('user-1', 'missing-id')).rejects.toMatchObject(
        {
          message: 'AWS account not found',
        },
      );
    });

    it('does not call invalidateStsCache when account is not found', async () => {
      mockQuery.mockResolvedValue([]); // getAccountById returns null every call

      await expect(deleteAccount('user-1', 'missing')).rejects.toThrow(
        NotFoundError,
      );
      expect(mockInvalidateStsCache).not.toHaveBeenCalled();
    });
  });
});
