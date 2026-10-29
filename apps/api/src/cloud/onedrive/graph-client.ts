import { ForbiddenError, GraphError, OfflineError, ReconnectRequiredError } from '../errors';

export interface TokenSource {
  getAccessToken(forceRefresh: boolean): Promise<string>;
}

interface Options {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

const BASE = 'https://graph.microsoft.com/v1.0';
const MAX_WAIT_MS = 60_000;

export class GraphClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;

  constructor(private readonly tokens: TokenSource, opts: Options = {}) {
    this.fetchImpl = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxRetries = opts.maxRetries ?? 6;
  }

  async request<T>(method: string, pathOrUrl: string, body?: unknown): Promise<{ status: number; data: T | null }> {
    const absolute = pathOrUrl.startsWith('https://');
    if (absolute && !pathOrUrl.startsWith('https://graph.microsoft.com/')) {
      throw new Error('URL fora do Microsoft Graph recusada.');
    }
    const url = absolute ? pathOrUrl : `${BASE}${pathOrUrl}`;
    let forceRefresh = false;
    let refreshed = false;
    let retries = 0;
    for (;;) {
      const token = await this.tokens.getAccessToken(forceRefresh);
      forceRefresh = false;
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch {
        throw new OfflineError();
      }

      if (res.status === 401) {
        if (refreshed) throw new ReconnectRequiredError();
        refreshed = true;
        forceRefresh = true;
        continue;
      }
      if ((res.status === 429 || res.status === 503) && retries < this.maxRetries) {
        const retryAfter = Number(res.headers.get('Retry-After'));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(2 ** retries * 1000, MAX_WAIT_MS);
        retries += 1;
        await this.sleep(wait);
        continue;
      }
      if (res.status === 403) throw new ForbiddenError();
      if (res.status === 404 || res.status === 409) return { status: res.status, data: null };
      if (!res.ok) throw new GraphError(res.status, await res.text());
      if (res.status === 204) return { status: 204, data: null };
      const text = await res.text();
      return { status: res.status, data: text ? (JSON.parse(text) as T) : null };
    }
  }
}
