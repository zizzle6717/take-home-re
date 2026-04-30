import express, { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { renewalRiskRouter } from './api/renewalRisk';
import { renewalEventsRouter } from './api/renewalEvents';
import { adminWebhooksRouter } from './api/adminWebhooks';
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

  // Dev-only permissive CORS. The take-home runs the API on :3000 and the
  // Vite dev server on :5173, so a same-origin assumption breaks as soon as
  // an evaluator runs the frontend on a non-localhost host. Production would
  // mount a real per-origin allowlist; here we just unblock the dashboard.
  if (config.NODE_ENV !== 'production') {
    app.use((req: Request, res: Response, next: NextFunction) => {
      res.header('Access-Control-Allow-Origin', req.header('Origin') ?? '*');
      res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key');
      if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }
      next();
    });
  }

  app.get('/healthz', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/v1', renewalRiskRouter);
  app.use('/api/v1', renewalEventsRouter);
  app.use('/api/v1', adminWebhooksRouter);

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
