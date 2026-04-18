import { vi } from 'vitest';
import type { QueryResult } from 'pg';

// ---------------------------------------------------------------------------
// Mock query factory — injects into services/tools without hitting real DB
// ---------------------------------------------------------------------------

export function makeMockQuery<T = Record<string, unknown>>(rows: T[] = []) {
  return vi.fn().mockResolvedValue(rows);
}

export function makeMockQueryError(error: Error) {
  return vi.fn().mockRejectedValue(error);
}

// ---------------------------------------------------------------------------
// Mock Redis client
// ---------------------------------------------------------------------------

export function makeMockRedis(infoOutput = '') {
  return {
    status: 'ready' as string,
    info: vi.fn().mockResolvedValue(infoOutput),
    connect: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Mock pg PoolClient (for withTransaction tests)
// ---------------------------------------------------------------------------

export function makeMockPgClient(rows: Record<string, unknown>[] = []) {
  const queryResult: QueryResult = {
    rows,
    rowCount: rows.length,
    command: '',
    oid: 0,
    fields: [],
  };
  return {
    query: vi.fn().mockResolvedValue(queryResult),
    release: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Test user factories
// ---------------------------------------------------------------------------

export function makeTestUser(
  overrides: Partial<{
    id: string;
    email: string;
    password_hash: string;
    role: 'user' | 'admin';
    created_at: Date;
    last_login_at: Date | null;
  }> = {},
) {
  return {
    id: 'test-user-id-123',
    email: 'test@example.com',
    password_hash: '$2b$12$hashedpasswordexample',
    role: 'user' as const,
    created_at: new Date('2026-01-01'),
    last_login_at: null,
    ...overrides,
  };
}

export function makeTestConversation(
  overrides: Partial<{
    id: string;
    user_id: string;
    created_at: Date;
    updated_at: Date;
  }> = {},
) {
  return {
    id: 'test-conv-id-456',
    user_id: 'test-user-id-123',
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
    ...overrides,
  };
}

// Redis INFO uses \r\n line endings — match the actual protocol output
export const SAMPLE_REDIS_INFO = [
  '# Server',
  'redis_version:7.0.0',
  'uptime_in_seconds:3600',
  '',
  '# Stats',
  'total_commands_processed:10000',
  'keyspace_hits:800',
  'keyspace_misses:200',
  '',
  '# Clients',
  'connected_clients:5',
  '',
  '# Memory',
  'used_memory:5242880',
].join('\r\n');
