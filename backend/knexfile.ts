import 'dotenv/config';
import type { Knex } from 'knex';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

const config: { [key: string]: Knex.Config } = {
  development: {
    client: 'pg',
    connection: databaseUrl,
    migrations: {
      directory: './migrations',
      extension: 'ts',
      loadExtensions: ['.ts'],
    },
    seeds: {
      directory: './seeds',
      extension: 'ts',
      loadExtensions: ['.ts'],
    },
    pool: { min: 0, max: 10 },
  },
  production: {
    client: 'pg',
    connection: databaseUrl,
    migrations: {
      directory: './migrations',
      extension: 'js',
      loadExtensions: ['.js'],
    },
    seeds: {
      directory: './seeds',
      extension: 'js',
      loadExtensions: ['.js'],
    },
    pool: { min: 0, max: 10 },
  },
};

export default config;
module.exports = config;
