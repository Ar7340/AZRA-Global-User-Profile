import { env } from '../src/config/env.js';
import { initStore, closeStore, stopAggregationWorker, healthCheck } from '../src/index.js';
import { createClient } from './client.js';
import { registerListeners } from './listeners/index.js';
import { logger } from '../src/utils/logger.js';

const log = logger.child('bot');

async function main() {
  if (!env.discord.token || !env.discord.clientId) {
    console.error(
      'Missing DISCORD_TOKEN or DISCORD_CLIENT_ID.\n' +
        'Copy .env.example to .env and fill in the Discord section.',
    );
    process.exit(1);
  }

  await initStore();
  log.info('store ready', await healthCheck());

  const client = createClient();
  registerListeners(client);
  await client.login(env.discord.token);

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`${signal} received — flushing store and disconnecting`);
    stopAggregationWorker();
    await client.destroy().catch(() => {});
    await closeStore();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Bot failed to start:', err);
  process.exit(1);
});
