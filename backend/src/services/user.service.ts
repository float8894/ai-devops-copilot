import { query } from '../lib/database.js';
import { createLogger } from '../lib/logger.js';
import { DatabaseError } from '../errors/index.js';

const log = createLogger({ service: 'user-service' });

export type UserRole = 'user' | 'admin';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  lastLoginAt: Date | null;
  createdAt: Date;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: UserRole;
  last_login_at: Date | null;
  created_at: Date;
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
  };
}

export async function createUser(
  email: string,
  passwordHash: string,
  role: UserRole = 'user',
): Promise<User> {
  try {
    const rows = await query<UserRow>(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, $3)
       RETURNING id, email, password_hash, role, last_login_at, created_at`,
      [email.toLowerCase().trim(), passwordHash, role],
    );
    const row = rows[0];
    if (!row) throw new DatabaseError('Insert returned no row');
    log.info({ userId: row.id, role }, 'User created');
    return rowToUser(row);
  } catch (err) {
    // Unique violation on email
    if ((err as NodeJS.ErrnoException & { code?: string }).code === '23505') {
      throw new DatabaseError('Email already registered', err);
    }
    throw new DatabaseError('Failed to create user', err);
  }
}

export async function findUserByEmail(email: string): Promise<User | null> {
  try {
    const rows = await query<UserRow>(
      `SELECT id, email, password_hash, role, last_login_at, created_at
       FROM users WHERE email = $1`,
      [email.toLowerCase().trim()],
    );
    const row = rows[0];
    return row ? rowToUser(row) : null;
  } catch (err) {
    throw new DatabaseError('Failed to find user', err);
  }
}

export async function findUserById(id: string): Promise<User | null> {
  try {
    const rows = await query<UserRow>(
      `SELECT id, email, password_hash, role, last_login_at, created_at
       FROM users WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    return row ? rowToUser(row) : null;
  } catch (err) {
    throw new DatabaseError('Failed to find user', err);
  }
}

export async function updateLastLogin(userId: string): Promise<void> {
  try {
    await query(
      `UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [userId],
    );
  } catch (err) {
    // Non-fatal — log and continue
    log.warn({ err, userId }, 'Failed to update last_login_at');
  }
}

export async function isFirstUser(): Promise<boolean> {
  try {
    const rows = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM users`,
      [],
    );
    return (rows[0]?.count ?? '0') === '0';
  } catch (err) {
    throw new DatabaseError('Failed to count users', err);
  }
}
