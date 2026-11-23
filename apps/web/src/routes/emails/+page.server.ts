import { fail, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { emailList, markEmails } from '$lib/server/email-list';

// List and mark logic live in $lib/server/email-list (shared with the mobile app API).
export const load: PageServerLoad = async ({ url, locals }) => {
  const { folders: _folders, ...data } = await emailList(url.searchParams, locals.user);
  return data;
};

export const actions: Actions = {
  mark: async ({ request, locals }) => {
    const form = await request.formData();
    const keys = [...form.getAll('key'), ...form.getAll('keys')].map(String);
    const r = await markEmails(locals.user, keys, String(form.get('op') || ''), String(form.get('value') || ''));
    if (!r.ok) return fail(400, { error: r.error });
    return r.warning ? { marked: r.marked, warning: r.warning } : { marked: r.marked };
  }
};
