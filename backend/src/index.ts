import { createApp } from './orchestrator/index.js';
import { env } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { db } from './lib/database.js';
import { redis } from './lib/redis.js';

const log = createLogger({ service: 'main' });

const app = createApp();
const server = app.listen(env.PORT, () => {
  log.info({ port: env.PORT, env: env.NODE_ENV }, 'Server started');
});

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'Shutdown initiated');

  // Stop accepting new connections
  server.close(async () => {
    try {
      await Promise.all([db.end(), redis.quit()]);
      log.info('Shutdown complete');
      process.exit(0);
    } catch (err) {
      log.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  });

  // Force exit if graceful shutdown takes too long
  setTimeout(() => {
    log.error('Shutdown timeout — forcing exit');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  log.fatal({ err }, 'Uncaught exception — shutting down');
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  log.fatal({ reason }, 'Unhandled rejection — shutting down');
  shutdown('unhandledRejection');
});
