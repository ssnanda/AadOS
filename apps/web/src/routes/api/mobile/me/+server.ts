import { json } from '@sveltejs/kit';

// Who the app is signed in as (also how the app checks its stored token on start: 401 = sign in again).
export const GET = ({ locals }) => {
  const u = locals.user!;
  return json({ version: __APP_VERSION__, user: { name: u.name, owner: u.owner, permissions: u.permissions, ownAccounts: u.ownAccounts } }, { headers: { 'cache-control': 'no-store' } });
};
