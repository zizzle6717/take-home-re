import path from 'path';
import knex, { Knex } from 'knex';
import { config } from '../config';

const knexConfig: Knex.Config = {
  client: 'pg',
  connection: config.DATABASE_URL,
  migrations: {
    directory: path.resolve(__dirname, '../../migrations'),
    extension: 'ts',
    loadExtensions: ['.ts'],
  },
  seeds: {
    directory: path.resolve(__dirname, '../../seeds'),
    extension: 'ts',
    loadExtensions: ['.ts'],
  },
  pool: { min: 0, max: 10 },
};

export const db: Knex = knex(knexConfig);
