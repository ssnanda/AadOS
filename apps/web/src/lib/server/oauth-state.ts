import { timingSafeEqual } from 'node:crypto';

/** Constant-time OAuth `state` check; false when no flow is pending or it expired. */
export function validOAuthState(expected: string, expiresAt: number, returned: string): boolean {
  if (!expected || expiresAt < Date.now()) return false;
  const a = Buffer.from(expected), b = Buffer.from(returned);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Several connect flows can be pending at once (e.g. two Gmail tabs); each has its own state token.
/** `owner`: the family member who started the connect (their account); absent = the owner of AadOS. */
export type PendingFlow = { expiresAt: number; verifier?: string; owner?: string };
export type PendingFlows = Record<string, PendingFlow>;
const MAX_PENDING = 10;
export const FLOW_TTL_MS = 10 * 60 * 1000;

/** Register a new flow (random `token` supplied by the caller); drops expired and the oldest beyond the cap. */
export function addFlow(pending: PendingFlows, token: string, verifier?: string, now = Date.now(), owner?: string): void {
  for (const key of Object.keys(pending)) if (pending[key].expiresAt < now) delete pending[key];
  const keys = Object.keys(pending).sort((a, b) => pending[a].expiresAt - pending[b].expiresAt);
  while (keys.length >= MAX_PENDING) delete pending[keys.shift()!];
  pending[token] = { expiresAt: now + FLOW_TTL_MS, ...(verifier ? { verifier } : {}), ...(owner ? { owner } : {}) };
}

/** Constant-time lookup; consumes (deletes) the matching flow so a callback can be used once. */
export function consumeFlow(pending: PendingFlows, returned: string, now = Date.now()): PendingFlow | null {
  let hit: string | null = null;
  for (const key of Object.keys(pending)) {
    const a = Buffer.from(key), b = Buffer.from(returned);
    if (a.length === b.length && timingSafeEqual(a, b)) hit = key;
  }
  if (!hit) return null;
  const flow = pending[hit];
  delete pending[hit];
  return flow.expiresAt >= now ? flow : null;
}
