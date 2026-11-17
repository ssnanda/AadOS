// Narrow server-to-server client for the owner's existing AJMCP gateway (https://github.com/ssnanda/ajmcp-server).
// AadOS never builds its own gateway or picks the model: AJMCP applies the provider/model/system prompt configured for
// AadOS's own site token. The token lives only in server env (never sent to the browser). Pure: fetch is injectable.

export type ChatMessage = { role: 'user' | 'assistant'; content: string };
export type AiErrorKind = 'not_configured' | 'disabled' | 'auth' | 'forbidden' | 'rate_limit' | 'busy' | 'too_large' | 'invalid_request' | 'timeout' | 'unavailable' | 'invalid_response' | 'cancelled';
export class AiError extends Error {
  kind: AiErrorKind; status: number;
  constructor(kind: AiErrorKind, message: string, status = 0) { super(message); this.kind = kind; this.status = status; this.name = 'AiError'; }
}
export type ChatResult = { reply: string; provider: string; model: string; usage: Record<string, number> | null; requestId: string; latencyMs: number };
export type Capabilities = { version: string; id: string; provider: string | null; endpoints: string[] };

// AJMCP defaults (docs/API.md): 32 KB JSON, 20 messages, 6000 characters each. Configurable in case the gateway is tuned.
export type Limits = { maxBytes: number; maxMessages: number; maxChars: number };
export const DEFAULT_LIMITS: Limits = { maxBytes: 32 * 1024, maxMessages: 20, maxChars: 6000 };

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export type ClientOptions = { baseUrl: string; token: string; httpHosts?: string[]; timeoutMs?: number; retries?: number; limits?: Partial<Limits>; fetchImpl?: Fetch; sleep?: (ms: number) => Promise<void> };

/** Only HTTPS, except loopback and hosts explicitly listed in AADOS_ALLOW_HTTP_HOSTS (local Docker mocks/tests). */
export function validBaseUrl(value: string, httpHosts: string[] = []): boolean {
  try { const u = new URL(value); return u.protocol === 'https:' || (u.protocol === 'http:' && (['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || httpHosts.includes(u.hostname))); }
  catch { return false; }
}

const FRIENDLY: Record<AiErrorKind, string> = {
  not_configured: 'AI is not configured (AADOS_AJMCP_URL / AADOS_AJMCP_TOKEN).', disabled: 'AI is turned off in Settings → AI.',
  auth: 'AJMCP rejected the AadOS token.', forbidden: 'This AJMCP token is not allowed to chat (site token required).',
  rate_limit: 'AJMCP rate limit reached; try again in a minute.', busy: 'AJMCP is busy; try again shortly.',
  too_large: 'The request was too large for AJMCP.', invalid_request: 'AJMCP rejected the request.',
  timeout: 'AJMCP did not answer in time.', unavailable: 'AJMCP is unavailable.', invalid_response: 'AJMCP returned an unexpected response.', cancelled: 'Cancelled.'
};
export const describeError = (e: unknown) => e instanceof AiError ? FRIENDLY[e.kind] : 'AI request failed.';
const RETRYABLE = new Set<AiErrorKind>(['busy', 'unavailable', 'timeout']);

function classify(status: number, code: string): AiError {
  if (status === 401) return new AiError('auth', code || 'unauthorized', status);
  if (status === 403) return new AiError('forbidden', code || 'forbidden', status);
  if (status === 413) return new AiError('too_large', code || 'request_too_large', status);
  if (status === 429) return new AiError('rate_limit', code || 'rate_limit', status);
  if (status === 503 && code === 'busy') return new AiError('busy', code, status);
  if (status >= 500) return new AiError('unavailable', code || `HTTP ${status}`, status);
  return new AiError('invalid_request', code || `HTTP ${status}`, status);
}

/** Validate and trim to AJMCP limits: keeps the newest turns, refuses an over-long latest message. */
export function fitMessages(messages: ChatMessage[], limits: Limits = DEFAULT_LIMITS): ChatMessage[] {
  const clean = messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.trim() }));
  if (!clean.length || clean[clean.length - 1].role !== 'user') throw new AiError('invalid_request', 'last message must be from the user');
  if (clean[clean.length - 1].content.length > limits.maxChars) throw new AiError('too_large', `message longer than ${limits.maxChars} characters`);
  // Older turns are truncated, then dropped (oldest first) until count and byte limits fit.
  let out = clean.map((m, i) => i === clean.length - 1 ? m : { ...m, content: m.content.slice(0, limits.maxChars) }).slice(-limits.maxMessages);
  while (out.length > 1 && Buffer.byteLength(JSON.stringify({ messages: out })) > limits.maxBytes - 512) out = out.slice(1);
  if (out[0].role !== 'user') out = out.slice(1); // conversation starts with the user
  if (Buffer.byteLength(JSON.stringify({ messages: out })) > limits.maxBytes - 512) throw new AiError('too_large', 'request larger than AJMCP allows');
  return out;
}

export function createAjmcpClient(opts: ClientOptions) {
  const limits: Limits = { ...DEFAULT_LIMITS, ...(opts.limits || {}) };
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = opts.timeoutMs ?? 60_000, retries = Math.min(Math.max(opts.retries ?? 2, 0), 4);
  if (!opts.baseUrl || !opts.token) throw new AiError('not_configured', 'missing URL or token');
  if (!validBaseUrl(opts.baseUrl, opts.httpHosts)) throw new AiError('not_configured', 'AJMCP URL must be https');
  const base = opts.baseUrl.replace(/\/+$/, '');

  async function call(path: string, init: RequestInit, signal?: AbortSignal): Promise<{ body: any; latencyMs: number }> {
    let last: AiError = new AiError('unavailable', 'no attempt');
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (signal?.aborted) throw new AiError('cancelled', 'cancelled');
      const started = Date.now();
      const timeout = AbortSignal.timeout(timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      try {
        const res = await fetchImpl(base + path, { ...init, headers: { Authorization: `Bearer ${opts.token}`, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) }, signal: combined });
        const text = await res.text();
        let body: any = null;
        try { body = text ? JSON.parse(text) : null; } catch { if (res.ok) throw new AiError('invalid_response', 'not JSON'); }
        if (!res.ok) throw classify(res.status, typeof body?.error === 'string' ? body.error.slice(0, 80) : '');
        return { body, latencyMs: Date.now() - started };
      } catch (cause) {
        if (signal?.aborted) throw new AiError('cancelled', 'cancelled');
        last = cause instanceof AiError ? cause : timeout.aborted ? new AiError('timeout', `no answer within ${timeoutMs} ms`) : new AiError('unavailable', 'network error');
        if (!RETRYABLE.has(last.kind) || attempt === retries) throw last;
        await sleep(Math.min(1000 * 2 ** attempt, 8000));
      }
    }
    throw last;
  }

  return {
    limits,
    async capabilities(signal?: AbortSignal): Promise<Capabilities> {
      const { body } = await call('/v1/capabilities', { method: 'GET' }, signal);
      if (!body || typeof body !== 'object') throw new AiError('invalid_response', 'capabilities');
      return { version: String(body.version || ''), id: String(body.id || ''), provider: body.provider ? String(body.provider) : null, endpoints: Array.isArray(body.endpoints) ? body.endpoints.map(String) : [] };
    },
    async chat(messages: ChatMessage[], signal?: AbortSignal): Promise<ChatResult> {
      const fitted = fitMessages(messages, limits);
      const { body, latencyMs } = await call('/v1/chat', { method: 'POST', body: JSON.stringify({ messages: fitted }) }, signal);
      if (!body || typeof body.reply !== 'string' || !body.reply.trim()) throw new AiError('invalid_response', 'missing reply');
      const usage = body.usage && typeof body.usage === 'object' ? Object.fromEntries(Object.entries(body.usage).filter(([, v]) => typeof v === 'number')) as Record<string, number> : null;
      return { reply: body.reply.trim(), provider: String(body.provider || ''), model: String(body.model || ''), usage, requestId: String(body.requestId || ''), latencyMs };
    }
  };
}
export type AjmcpClient = ReturnType<typeof createAjmcpClient>;
