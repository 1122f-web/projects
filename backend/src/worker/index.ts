// Standalone worker process: `npm run worker` (after `npm run build`).
// Use this when the API runs on a host that sleeps or scales to zero.
import { startWorker } from './jobs.js';
import { logger } from '../lib/logger.js';

const stop = startWorker();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info({ signal }, 'worker stopping');
    stop();
    process.exit(0);
  });
}
