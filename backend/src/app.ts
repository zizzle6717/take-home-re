import express, { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { renewalRiskRouter } from './api/renewalRisk';

// Express app factory. Lifted out of index.ts so test code can boot the
// app in-process via supertest without binding a port.

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const createApp = (): express.Express => {
  const app = express();
  app.use(express.json());

  app.get('/healthz', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/v1', renewalRiskRouter);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({
        error: {
          code: 'validation_error',
          message: 'Invalid request',
          details: err.flatten(),
        },
      });
      return;
    }
    console.error('Unhandled error:', err);
    const msg = err instanceof Error ? err.message : 'unknown';
    res.status(500).json({ error: { code: 'internal_error', message: msg } });
  });

  return app;
};
