import { env } from '$env/dynamic/private';
import { getConfig as loadFromEnv, type AppConfig } from './config';

/**
 * SvelteKit-runtime config accessor. Reads variables via `$env/dynamic/private`,
 * which surfaces the project `.env` in `vite dev` and the process environment under
 * adapter-node — unlike a bare `process.env` read, which does NOT see `.env` in dev.
 *
 * Kept in a separate module so the `$env` virtual import never enters the unit-test
 * graph (config.ts stays pure and is the one tests import).
 */
export function getConfig(): AppConfig {
  return loadFromEnv(env);
}
