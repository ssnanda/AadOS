import { join } from 'node:path';
import { env } from '$env/dynamic/private';

/** Persistent data directory shared by state.enc and security.json. */
export const dataDir = () => env.AADOS_DATA_DIR || (env.NODE_ENV === 'production' ? '/data/aados' : join(process.cwd(), '.data'));
