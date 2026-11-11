import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { startWorker } from './worker/jobs.js';

const app = createApp();
const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'MediConnect API listening');
});

const stopWorker = config.ENABLE_WORKER ? startWorker() : null;

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info({ signal }, 'shutting down');
    stopWorker?.();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
