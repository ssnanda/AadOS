// Bounded retry/backoff for provider APIs. Pure: fetch and sleep are injectable for tests.
type Options = { attempts?: number; timeoutMs?: number; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; maxWaitMs?: number };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Retries 429 and 5xx (honouring Retry-After) and network errors; other statuses return immediately. */
export async function fetchRetry(url: string, init: RequestInit = {}, options: Options = {}): Promise<Response> {
  const { attempts = 4, timeoutMs = 20000, fetchImpl = fetch, sleep = defaultSleep, maxWaitMs = 15000 } = options;
  for (let n = 0; ; n++) {
    const last = n >= attempts - 1;
    let response: Response;
    try { response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) }); }
    catch (cause) { if (last) throw cause; await sleep(Math.min(1000 * 2 ** n, maxWaitMs)); continue; }
    if (!(response.status === 429 || response.status >= 500) || last) return response;
    const retryAfter = Number(response.headers.get('retry-after')) * 1000;
    await sleep(Math.min(retryAfter > 0 ? retryAfter : 1000 * 2 ** n, maxWaitMs));
  }
}

/** True when an error means the stored refresh token no longer works and the owner must reconnect. */
export const needsReconnect = (message: string) => /invalid_grant|invalid_code|invalid_client|unauthorized_client|token has been expired or revoked|refresh token|HTTP 401/i.test(message);
