import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createLogger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';
import { getRedisStats } from '../tools/get-redis-stats.js';
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
      const stats: RedisStats = await getRedisStats();
      toolLog.info(
        { hit_rate: stats.hit_rate, memory_mb: stats.memory_used_mb },
        'Tool completed',
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(stats) }],
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
