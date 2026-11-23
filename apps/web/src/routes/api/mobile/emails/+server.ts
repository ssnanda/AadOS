import { json } from '@sveltejs/kit';
import { emailList } from '$lib/server/email-list';

// The /emails list as JSON for the mobile app: same query parameters (view, account, folder, q, category, sender,
// thread, page…), same rows and counts, plus the folder drawer. `pageSize` is capped at 100.
export const GET = async ({ url, locals }) => {
  const pageSize = Math.min(100, Math.max(10, Number(url.searchParams.get('pageSize')) || 50));
  const { categories, ...data } = await emailList(url.searchParams, locals.user, { pageSize, folders: true });
  return json({ ...data, categories: [...categories] }, { headers: { 'cache-control': 'no-store' } });
};
