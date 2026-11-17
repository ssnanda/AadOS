import { fail, type Actions } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import type { PageServerLoad } from './$types';
import { readState } from '$lib/server/aados-store';
import { sameUsername, security } from '$lib/server/auth';
import { PERMISSIONS, type Member, type Permission } from '$lib/server/security-store';
import { generatePassword, hashPassword } from '$lib/server/password.js';

// Family logins (owner only — /settings is owner-only in hooks). Passwords are scrypt hashes; a generated password is
// shown once, right after it is created.
export const load: PageServerLoad = async () => {
  const state = await readState();
  return {
    permissions: PERMISSIONS,
    // Only the owner's accounts can be shared; members' own accounts stay theirs.
    accounts: state.accounts.filter((a) => !a.ownerId).map((a) => ({ id: a.id, email: a.email || a.id, provider: a.provider })),
    members: security().members().map(({ passwordHash: _p, ...m }) => m)
  };
};

const perms = (f: FormData) => f.getAll('perm').map(String).filter((p): p is Permission => (PERMISSIONS as readonly string[]).includes(p));
const mailboxes = (f: FormData): string[] | 'all' => (f.get('allMail') === 'on' ? 'all' : f.getAll('mailbox').map(String).filter(Boolean));
const USERNAME = /^[a-z0-9._-]{3,32}$/i;

export const actions: Actions = {
  create: async ({ request }) => {
    const f = await request.formData();
    const name = String(f.get('name') || '').trim().slice(0, 60), username = String(f.get('username') || '').trim();
    let password = String(f.get('password') || '');
    if (!name) return fail(400, { error: 'Enter a name.' });
    if (!USERNAME.test(username)) return fail(400, { error: 'Username: 3–32 letters, digits, dot, dash or underscore.' });
    if (sameUsername(username) || security().memberByUsername(username)) return fail(400, { error: 'That username is already taken.' });
    const generated = !password;
    if (generated) password = generatePassword();
    if (password.length < 10) return fail(400, { error: 'Password: at least 10 characters (or leave it empty to generate one).' });
    const member: Member = { id: randomBytes(9).toString('base64url'), name, username, passwordHash: await hashPassword(password), permissions: perms(f), mailboxes: mailboxes(f), ownAccounts: f.get('ownAccounts') === 'on', ver: 1, createdAt: new Date().toISOString() };
    security().saveMember(member);
    return { created: name, shown: generated ? { username, password } : null };
  },
  update: async ({ request }) => {
    const f = await request.formData();
    const m = security().member(String(f.get('id') || ''));
    if (!m) return fail(404, { error: 'Member not found.' });
    m.name = String(f.get('name') || m.name).trim().slice(0, 60) || m.name;
    // Keep the member's own linked accounts visible to them whatever is ticked for the owner's mailboxes.
    const ownIds = (await readState()).accounts.filter((a) => a.ownerId === m.id).map((a) => a.id);
    const boxes = mailboxes(f);
    m.permissions = perms(f); m.mailboxes = boxes === 'all' ? 'all' : [...new Set([...boxes, ...ownIds])]; m.ownAccounts = f.get('ownAccounts') === 'on';
    security().saveMember(m);
    return { saved: m.name };
  },
  password: async ({ request }) => {
    const f = await request.formData();
    const m = security().member(String(f.get('id') || ''));
    if (!m) return fail(404, { error: 'Member not found.' });
    let password = String(f.get('password') || '');
    const generated = !password;
    if (generated) password = generatePassword();
    if (password.length < 10) return fail(400, { error: 'Password: at least 10 characters (or leave it empty to generate one).' });
    m.passwordHash = await hashPassword(password); m.ver += 1; // signs that member out everywhere
    security().saveMember(m);
    return { saved: m.name, shown: generated ? { username: m.username, password } : null };
  },
  toggle: async ({ request }) => {
    const m = security().member(String((await request.formData()).get('id') || ''));
    if (!m) return fail(404, { error: 'Member not found.' });
    m.disabled = !m.disabled; m.ver += 1;
    security().saveMember(m);
    return { saved: m.name };
  },
  remove: async ({ request }) => {
    const id = String((await request.formData()).get('id') || '');
    if (!security().member(id)) return fail(404, { error: 'Member not found.' });
    security().removeMember(id);
    return { removed: true };
  }
};
