import { Router, Request, Response } from 'express';
import { config } from '../config';

// Mock RMS endpoint. Lives in the same Express app to avoid running a second
// process during dev/testing. Mounted only when NODE_ENV !== 'production'
// (gated at the call site in app.ts). MOCK_RMS_FAILURE_RATE drives synthetic
// 503s so we can exercise the worker's retry/DLQ paths end-to-end.

export const mockRmsRouter = Router();

mockRmsRouter.post('/webhook', (req: Request, res: Response) => {
  const failureRate = config.MOCK_RMS_FAILURE_RATE;
  if (failureRate > 0 && Math.random() < failureRate) {
    res.status(503).json({ status: 'mock_rms_failure' });
    return;
  }

  const idempotencyKey = req.header('Idempotency-Key') ?? null;
  console.log(
    `mock_rms received eventId=${JSON.stringify(idempotencyKey)} bodyKeys=${JSON.stringify(Object.keys(req.body ?? {}))}`,
  );
  res.json({ status: 'ok' });
});
