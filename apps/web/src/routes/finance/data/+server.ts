import { json } from '@sveltejs/kit';
import { load } from '../+page.server';

// The finance page's data as JSON for the mobile app: the page's own load, so the app and the web never drift.
// Actions go through /finance/api as on the web.
export const GET = async (event) => json(await load(event as any), { headers: { 'cache-control': 'no-store' } });
