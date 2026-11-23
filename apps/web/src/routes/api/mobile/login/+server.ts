import { json } from '@sveltejs/kit';
import { createSession, sessionUser } from '$lib/server/auth';
import { checkLogin } from '$lib/server/login';

// Mobile app sign-in: username/password → the signed session token, sent back as `Authorization: Bearer`.
// Same lockout as the web form. JSON only (no cookies), so there is no form/CSRF path here.
export const POST = async ({ request, getClientAddress }) => {
  const body = await request.json().catch(() => null);
  const username = String(body?.username || '').slice(0, 200);
  const password = String(body?.password || '').slice(0, 500);
  if (!username || !password) return json({ error: 'Enter your username and password.' }, { status: 400 });
  const result = await checkLogin(username, password, getClientAddress());
  if (!result.ok) return json({ error: result.error }, { status: result.status });
  const token = createSession(result.member);
  const user = sessionUser(token)!;
  return json({ token, user: { name: user.name, owner: user.owner, permissions: user.permissions } }, { headers: { 'cache-control': 'no-store' } });
};
