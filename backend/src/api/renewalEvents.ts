import { Router, Request, Response, NextFunction } from 'express';
import { db } from '../db';
import { HttpError } from '../app';
import { enqueueRenewalEvent } from '../webhooks/enqueue';

// POST /properties/:propertyId/residents/:residentId/renewal-events
// Looks up the latest risk run for the property, then asks the enqueue
// helper to materialize an event + delivery_state row. Returns 202; the
// in-process worker picks up delivery on its next tick.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const renewalEventsRouter = Router();

renewalEventsRouter.post(
  '/properties/:propertyId/residents/:residentId/renewal-events',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { propertyId, residentId } = req.params;
      if (!UUID_RE.test(propertyId) || !UUID_RE.test(residentId)) {
        throw new HttpError(400, 'invalid_uuid', 'propertyId and residentId must be UUIDs');
      }

      const run = await db('risk_calculation_runs')
        .where({ property_id: propertyId })
        .orderBy('calculated_at', 'desc')
        .first<{ id: string }>('id');
      if (!run) {
        throw new HttpError(
          404,
          'no_run',
          `no risk calculation runs for property ${propertyId}`,
        );
      }

      const result = await enqueueRenewalEvent(propertyId, residentId, run.id);
      res.status(202).json({
        eventId: result.eventId,
        status: result.alreadyExists ? 'already_exists' : 'queued',
      });
    } catch (err) {
      next(err);
    }
  },
);
