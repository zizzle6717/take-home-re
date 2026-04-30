import knex, { Knex } from 'knex';
import { config } from '../config';

const knexConfig: Knex.Config = {
  client: 'pg',
  connection: config.DATABASE_URL,
  pool: { min: 0, max: 10 },
};

export const db: Knex = knex(knexConfig);
