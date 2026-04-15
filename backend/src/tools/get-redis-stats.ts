import { redis } from '../lib/redis.js';
import type { RedisStats } from '../models/job.js';

export async function getRedisStats(): Promise<RedisStats> {
  // Ensure connected — with lazyConnect + enableOfflineQueue:false we must
  // explicitly reconnect if the stream was closed (e.g. after a watch reload)
  if (
    redis.status === 'close' ||
    redis.status === 'end' ||
    redis.status === 'wait'
  ) {
    await redis.connect();
  }

  const info = await redis.info();

  const parsed: Record<string, string> = {};
  for (const line of info.split('\r\n')) {
    if (line.startsWith('#') || line.trim() === '') continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    parsed[line.slice(0, colonIdx).trim()] = line.slice(colonIdx + 1).trim();
  }

  const hits = parseInt(parsed['keyspace_hits'] ?? '0', 10);
  const misses = parseInt(parsed['keyspace_misses'] ?? '0', 10);
  const total = hits + misses;
  const hitRate = total > 0 ? Math.round((hits / total) * 10000) / 100 : 0;

  const memBytes = parseInt(parsed['used_memory'] ?? '0', 10);

  return {
    hit_rate: hitRate,
    memory_used_mb: Math.round((memBytes / 1024 / 1024) * 100) / 100,
    connected_clients: parseInt(parsed['connected_clients'] ?? '0', 10),
    total_commands_processed: parseInt(
      parsed['total_commands_processed'] ?? '0',
      10,
    ),
    keyspace_hits: hits,
    keyspace_misses: misses,
    uptime_seconds: parseInt(parsed['uptime_in_seconds'] ?? '0', 10),
  };
}
