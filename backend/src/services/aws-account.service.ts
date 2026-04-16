import { query, withTransaction } from '../lib/database.js';
import { createLogger } from '../lib/logger.js';
import { DatabaseError, NotFoundError } from '../errors/index.js';
import { invalidateStsCache } from '../lib/sts.js';

const log = createLogger({ service: 'aws-account-service' });

export interface AwsAccount {
  id: string;
  userId: string;
  name: string;
  roleArn: string;
  isDefault: boolean;
  createdAt: Date;
}

interface AwsAccountRow {
  id: string;
  user_id: string;
  name: string;
  role_arn: string;
  is_default: boolean;
  created_at: Date;
}

function rowToAccount(row: AwsAccountRow): AwsAccount {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    roleArn: row.role_arn,
    isDefault: row.is_default,
    createdAt: row.created_at,
  };
}

export async function addAccount(
  userId: string,
  name: string,
  roleArn: string,
  makeDefault = false,
): Promise<AwsAccount> {
  return withTransaction(async (client) => {
    if (makeDefault) {
      await client.query(
        `UPDATE aws_accounts SET is_default = false, updated_at = NOW()
         WHERE user_id = $1`,
        [userId],
      );
    } else {
      // Check if this is the first account — auto-default
      const count = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM aws_accounts WHERE user_id = $1`,
        [userId],
      );
      if ((count.rows[0]?.count ?? '0') === '0') makeDefault = true;
    }

    const result = await client.query<AwsAccountRow>(
      `INSERT INTO aws_accounts (user_id, name, role_arn, is_default)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, name, role_arn, is_default, created_at`,
      [userId, name, roleArn, makeDefault],
    );

    const row = result.rows[0];
    if (!row) throw new DatabaseError('Insert returned no row');

    log.info({ userId, accountId: row.id, name }, 'AWS account added');
    return rowToAccount(row);
  });
}

export async function listAccounts(userId: string): Promise<AwsAccount[]> {
  try {
    const rows = await query<AwsAccountRow>(
      `SELECT id, user_id, name, role_arn, is_default, created_at
       FROM aws_accounts WHERE user_id = $1
       ORDER BY is_default DESC, created_at ASC`,
      [userId],
    );
    return rows.map(rowToAccount);
  } catch (err) {
    throw new DatabaseError('Failed to list AWS accounts', err);
  }
}

export async function getDefaultAccount(
  userId: string,
): Promise<AwsAccount | null> {
  try {
    const rows = await query<AwsAccountRow>(
      `SELECT id, user_id, name, role_arn, is_default, created_at
       FROM aws_accounts WHERE user_id = $1 AND is_default = true`,
      [userId],
    );
    const row = rows[0];
    return row ? rowToAccount(row) : null;
  } catch (err) {
    throw new DatabaseError('Failed to get default AWS account', err);
  }
}

export async function getAccountById(
  userId: string,
  accountId: string,
): Promise<AwsAccount | null> {
  try {
    const rows = await query<AwsAccountRow>(
      `SELECT id, user_id, name, role_arn, is_default, created_at
       FROM aws_accounts WHERE id = $1 AND user_id = $2`,
      [accountId, userId],
    );
    const row = rows[0];
    return row ? rowToAccount(row) : null;
  } catch (err) {
    throw new DatabaseError('Failed to get AWS account', err);
  }
}

export async function deleteAccount(
  userId: string,
  accountId: string,
): Promise<void> {
  const account = await getAccountById(userId, accountId);
  if (!account) throw new NotFoundError('AWS account not found');

  await query(
    `DELETE FROM aws_accounts WHERE id = $1 AND user_id = $2`,
    [accountId, userId],
  );

  // Invalidate any cached STS credentials for this account
  await invalidateStsCache(userId, accountId);

  log.info({ userId, accountId }, 'AWS account deleted');
}
