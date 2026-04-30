import express, { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { renewalRiskRouter } from './api/renewalRisk';
import { renewalEventsRouter } from './api/renewalEvents';
import { mockRmsRouter } from './webhooks/mockRms';
import { config } from './config';

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

export interface CreateAppOptions {
  // Reserved for future hooks (e.g., starting the in-process worker from
  // the app factory). Kept in the signature now so test code can pass
  // `{ workerEnabled: false }` without churn later.
  workerEnabled?: boolean;
}

export const createApp = (_opts: CreateAppOptions = {}): express.Express => {
  const app = express();
  app.use(express.json());

  app.get('/healthz', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/v1', renewalRiskRouter);
  app.use('/api/v1', renewalEventsRouter);

  if (config.NODE_ENV !== 'production') {
    app.use('/__mock_rms', mockRmsRouter);
  }

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
