import { json } from '@sveltejs/kit';
import { load } from '../+page.server';

// The calendar page's data as JSON for the mobile app (same `view`, `date`, `account`, `off` parameters and the same
// permission checks — this path sits under /calendar). One source: the page's own load.
export const GET = async (event) => json(await load(event as any), { headers: { 'cache-control': 'no-store' } });
