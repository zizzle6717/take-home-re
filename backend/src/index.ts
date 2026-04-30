import { config } from './config';
import { db } from './db';
import { createApp } from './app';
import { WebhookWorker } from './webhooks/worker';

async function main(): Promise<void> {
  await db.raw('select 1');
  console.log('Database connected');

  const app = createApp();
  const server = app.listen(config.PORT, () => {
    console.log(`Server on :${config.PORT}`);
  });

  const worker = new WebhookWorker({ pollMs: config.WORKER_POLL_MS });
  worker.start();
  console.log(`Webhook worker started (pollMs=${config.WORKER_POLL_MS})`);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, shutting down`);
    try {
      await worker.stop();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await db.destroy();
      process.exit(0);
    } catch (err) {
      console.error('Shutdown error:', err);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
