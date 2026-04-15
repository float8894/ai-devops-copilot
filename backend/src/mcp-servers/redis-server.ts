import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createLogger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';
import type { RedisStats } from '../models/job.js';

const log = createLogger({ service: 'mcp-redis' });

const server = new McpServer({
  name: 'redis-server',
  version: '1.0.0',
});

server.registerTool(
  'get_redis_stats',
  {
    title: 'Get Redis Cache Stats',
    description:
      'Get Redis cache performance statistics by running the INFO command. ' +
      'Returns hit rate percentage, memory usage in MB, connected clients, ' +
      'total commands processed, and uptime. ' +
      'Use this when the user asks about: cache performance, Redis health, ' +
      'cache hit rate, memory usage, cache anomalies, slow responses, ' +
      'cache efficiency, Redis status, is the cache healthy.',
    inputSchema: {},
  },
  async () => {
    const toolLog = createLogger({ tool: 'get_redis_stats' });
    toolLog.info('Tool invoked');

    try {
      if (
        redis.status === 'close' ||
        redis.status === 'end' ||
        redis.status === 'wait'
      ) {
        await redis.connect();
      }

      const info = await redis.info();

      // Parse the INFO output — each line is "key:value\r\n"
      const parsed: Record<string, string> = {};
      for (const line of info.split('\r\n')) {
        if (line.startsWith('#') || line.trim() === '') continue;
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const key = line.slice(0, colonIdx).trim();
        const val = line.slice(colonIdx + 1).trim();
        parsed[key] = val;
      }

      const hits = parseInt(parsed['keyspace_hits'] ?? '0', 10);
      const misses = parseInt(parsed['keyspace_misses'] ?? '0', 10);
      const total = hits + misses;
      const hitRate = total > 0 ? Math.round((hits / total) * 10000) / 100 : 0;

      const memBytes = parseInt(parsed['used_memory'] ?? '0', 10);
      const memMb = Math.round((memBytes / 1024 / 1024) * 100) / 100;

      const stats: RedisStats = {
        hit_rate: hitRate,
        memory_used_mb: memMb,
        connected_clients: parseInt(parsed['connected_clients'] ?? '0', 10),
        total_commands_processed: parseInt(
          parsed['total_commands_processed'] ?? '0',
          10,
        ),
        keyspace_hits: hits,
        keyspace_misses: misses,
        uptime_seconds: parseInt(parsed['uptime_in_seconds'] ?? '0', 10),
      };

      toolLog.info(
        { hit_rate: stats.hit_rate, memory_mb: stats.memory_used_mb },
        'Tool completed',
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(stats),
          },
        ],
      };
    } catch (err) {
      toolLog.error({ err }, 'Tool failed');
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error fetching Redis stats: ${err instanceof Error ? err.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  },
);

async function shutdown() {
  await redis.quit();
  await server.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

const transport = new StdioServerTransport();
await server.connect(transport);
log.info('Redis MCP server running');
