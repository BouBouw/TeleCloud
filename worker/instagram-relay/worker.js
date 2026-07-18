/**
 * Cloudflare Worker — Instagram fetch relay
 *
 * Acts as a transparent HTTP relay for Instagram API/page requests.
 * Requests leave from Cloudflare edge IPs (not blocked by Instagram).
 *
 * Deploy:
 *   cd worker/instagram-relay
 *   npx wrangler deploy
 *   npx wrangler secret put RELAY_SECRET   ← set a strong random secret
 *
 * Env vars required on the server:
 *   INSTAGRAM_CF_WORKER_URL    = https://instagram-relay.<subdomain>.workers.dev
 *   INSTAGRAM_CF_WORKER_SECRET = <same secret as above>
 */

export default {
  async fetch(request, env) {
    // ── Auth ────────────────────────────────────────────────────────
    const auth = request.headers.get('Authorization')
    if (!env.RELAY_SECRET || auth !== `Bearer ${env.RELAY_SECRET}`) {
      return new Response('Unauthorized', { status: 401 })
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    let body
    try {
      body = await request.json()
    } catch {
      return new Response('Invalid JSON body', { status: 400 })
    }

    const { url, headers: extraHeaders = {}, cookies } = body
    if (!url || typeof url !== 'string') {
      return new Response('Missing or invalid "url" field', { status: 400 })
    }

    // ── Security: only allow instagram domains (prevents SSRF) ─────
    let parsed
    try { parsed = new URL(url) } catch {
      return new Response('Invalid URL', { status: 400 })
    }
    const h = parsed.hostname
    const allowed =
      h === 'instagram.com' ||
      h.endsWith('.instagram.com') ||
      h.endsWith('.cdninstagram.com')
    if (!allowed) {
      return new Response(`Domain not allowed: ${h}`, { status: 403 })
    }

    // ── Forward request ─────────────────────────────────────────────
    try {
      const resp = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent':       'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
          'Accept':           'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language':  'en-US,en;q=0.9',
          'Sec-Fetch-Site':   'none',
          'Sec-Fetch-Mode':   'navigate',
          'Sec-Fetch-User':   '?1',
          // Extra headers from caller (e.g. X-IG-App-ID, X-Requested-With)
          ...extraHeaders,
          // Session cookies forwarded from the server's cookies file
          ...(cookies ? { Cookie: cookies } : {}),
        },
        redirect: 'follow',
        // Disable Cloudflare's scrape shield so responses are not altered
        cf: { scrapeShield: false, cacheEverything: false },
      })

      const responseBody = await resp.text()

      return new Response(JSON.stringify({
        ok:     resp.ok,
        status: resp.status,
        body:   responseBody,
      }), {
        headers: {
          'Content-Type':                'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      })
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: String(err) }), {
        status:  502,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  },
}
