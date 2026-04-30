import { config } from './config';
import { db } from './db';
import { createApp } from './app';

async function main(): Promise<void> {
  await db.raw('select 1');
  console.log('Database connected');

  const app = createApp();
  const server = app.listen(config.PORT, () => {
    console.log(`Server on :${config.PORT}`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`${signal} received, shutting down`);
    server.close(() => {
      void db.destroy().then(() => process.exit(0));
    });
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
