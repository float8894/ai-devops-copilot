import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SAMPLE_REDIS_INFO } from '../test/helpers.js';

// Mock the redis module before importing the tool
vi.mock('../lib/redis.js', () => ({
  redis: {
    status: 'ready',
    info: vi.fn(),
    connect: vi.fn(),
  },
}));

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { redis } from '../lib/redis.js';
import { getRedisStats } from './get-redis-stats.js';

const mockRedis = redis as unknown as {
  status: string;
  info: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRedis.status = 'ready';
  mockRedis.info.mockResolvedValue(SAMPLE_REDIS_INFO);
  mockRedis.connect.mockResolvedValue(undefined);
});

describe('getRedisStats', () => {
  it('parses INFO output into correct fields', async () => {
    const stats = await getRedisStats();

    expect(stats.hit_rate).toBe(80); // 800 hits / (800+200) = 80%
    expect(stats.keyspace_hits).toBe(800);
    expect(stats.keyspace_misses).toBe(200);
    expect(stats.connected_clients).toBe(5);
    expect(stats.total_commands_processed).toBe(10000);
    expect(stats.uptime_seconds).toBe(3600);
    // 5242880 bytes = 5 MB exactly
    expect(stats.memory_used_mb).toBe(5);
  });

  it('returns hit_rate 0 when there are no hits or misses (no division by zero)', async () => {
    mockRedis.info.mockResolvedValue(
      '# Stats\nkeyspace_hits:0\nkeyspace_misses:0\n',
    );

    const stats = await getRedisStats();
    expect(stats.hit_rate).toBe(0);
  });

  it('does NOT call connect() when status is "ready"', async () => {
    mockRedis.status = 'ready';

    await getRedisStats();

    expect(mockRedis.connect).not.toHaveBeenCalled();
  });

  it('does NOT call connect() when status is "wait" (backoff in progress)', async () => {
    mockRedis.status = 'wait';

    await getRedisStats();

    expect(mockRedis.connect).not.toHaveBeenCalled();
  });

  it('calls connect() when status is "close"', async () => {
    mockRedis.status = 'close';

    await getRedisStats();

    expect(mockRedis.connect).toHaveBeenCalledOnce();
  });

  it('calls connect() when status is "end"', async () => {
    mockRedis.status = 'end';

    await getRedisStats();

    expect(mockRedis.connect).toHaveBeenCalledOnce();
  });

  it('throws on redis.info() failure', async () => {
    mockRedis.info.mockRejectedValueOnce(new Error('Redis unavailable'));

    await expect(getRedisStats()).rejects.toThrow('Redis unavailable');
  });
});
