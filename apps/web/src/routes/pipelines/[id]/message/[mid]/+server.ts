import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { updateState } from '$lib/server/aados-store';
import { fetchZohoBody } from '$lib/server/zoho';
import { fetchGmailBody } from '$lib/server/gmail';

// Fetches one email body from the mailbox on demand (read-only) and marks it seen in AadOS.
export const GET: RequestHandler = async ({ params }) => {
  let body = { html: '', text: '' };
  try {
    await updateState(async (state) => {
      const pipeline = state.pipelines.find((item) => item.id === params.id);
      const item = state.items.find((entry) => entry.pipelineId === params.id && entry.messageId === params.mid);
      if (!pipeline || !item) throw new Error('Email not found');
      const account = state.accounts.find((entry) => entry.id === pipeline.accountId && entry.provider === pipeline.source);
      if (!account) throw new Error('The account for this view is no longer connected.');
      body = pipeline.source === 'gmail' ? await fetchGmailBody(state, account, item) : await fetchZohoBody(state, account, pipeline, item);
      item.seen = true;
    });
  } catch (cause) {
    throw error(502, cause instanceof Error ? cause.message : 'Could not load this email.');
  }
  return json(body);
};
