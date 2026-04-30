import express, { Request, Response, NextFunction } from 'express';
import { config } from './config';
import { db } from './db';

async function main(): Promise<void> {
  await db.raw('select 1');
  console.log('Database connected');

  const app = express();
  app.use(express.json());

  app.get('/healthz', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: { code: 'internal_error', message: err.message } });
  });

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
