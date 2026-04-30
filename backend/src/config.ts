import 'dotenv/config';
import { z } from 'zod';

const ConfigSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  RMS_WEBHOOK_URL: z.string().url().default('http://localhost:3000/__mock_rms/webhook'),
  WORKER_POLL_MS: z.coerce.number().int().positive().default(1000),
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  MOCK_RMS_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0),
});

const parsed = ConfigSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export type AppConfig = typeof config;
