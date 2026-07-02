import { UA } from './community';

/**
 * Reddit application-only (userless) OAuth.
 *
 * Reddit blocks keyless `www.reddit.com/*.json` from data-center IPs (403). With a
 * free Reddit app's client_id/secret we mint an app-only bearer token and route
 * requests through `oauth.reddit.com` instead — which is not IP-blocked.
 *
 * `makeRedditFetch` returns a drop-in `fetch` that transparently authenticates
 * Reddit URLs (rewriting host + dropping the keyless `.json` suffix) and passes
 * every other URL through untouched. Without credentials it returns the base
 * fetch unchanged, so the keyless path is preserved. A token failure rejects the
 * request, which callers treat as a per-source failure — never a crash.
 */

export interface RedditAuth {
  clientId: string;
  clientSecret: string;
}

interface CachedToken {
  token: string;
  exp: number; // epoch ms
}

// Module-level cache keyed by client_id — app-only tokens last ~1h, so reuse them
// across realDeps()/requests rather than minting one per request.
const tokenCache = new Map<string, CachedToken>();

/** Test-only: clear the cached tokens. */
export function __resetRedditTokenCache(): void {
  tokenCache.clear();
}

async function getToken(auth: RedditAuth, baseFetch: typeof fetch): Promise<string> {
  const hit = tokenCache.get(auth.clientId);
  if (hit && Date.now() < hit.exp) return hit.token;

  const basic = Buffer.from(`${auth.clientId}:${auth.clientSecret}`).toString('base64');
  const res = await baseFetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA
    },
    body: 'grant_type=client_credentials'
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Reddit token ${res.status}: ${detail.slice(0, 120)}`);
  }
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error('Reddit token response missing access_token');
  const ttlMs = ((body.expires_in ?? 3600) - 60) * 1000; // refresh a minute early
  tokenCache.set(auth.clientId, { token: body.access_token, exp: Date.now() + ttlMs });
  return body.access_token;
}

export function makeRedditFetch(auth: RedditAuth | undefined, baseFetch: typeof fetch = fetch): typeof fetch {
  if (!auth) return baseFetch; // keyless: callers set their own UA
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const urlStr = String(input);
    if (!urlStr.includes('reddit.com')) return baseFetch(input, init); // non-Reddit → passthrough
    const token = await getToken(auth, baseFetch);
    const url = urlStr
      .replace('://www.reddit.com', '://oauth.reddit.com')
      .replace(/\.json(\?|$)/, '$1');
    const headers = { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, 'User-Agent': UA };
    return baseFetch(url, { ...init, headers });
  }) as typeof fetch;
}
