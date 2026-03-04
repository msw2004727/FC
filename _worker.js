const TEAM_SHARE_PATH = "/team-share";
const TEAM_SHARE_OG_ORIGIN = "https://asia-east1-fc-football-6c8dc.cloudfunctions.net";
const TEAM_SHARE_OG_PATH = "/teamShareOg";
const EDGE_CACHE_TTL = 300; // 5 minutes

function isTeamSharePath(pathname) {
  return pathname === TEAM_SHARE_PATH || pathname.startsWith(`${TEAM_SHARE_PATH}/`);
}

function buildTeamShareOgUrl(requestUrl) {
  const incoming = new URL(requestUrl);
  const suffix = incoming.pathname.slice(TEAM_SHARE_PATH.length);
  const target = new URL(TEAM_SHARE_OG_ORIGIN);
  target.pathname = `${TEAM_SHARE_OG_PATH}${suffix}`;
  target.search = incoming.search;
  return target;
}

async function handleTeamShare(request) {
  if (!["GET", "HEAD"].includes(request.method)) {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: {
        "Allow": "GET, HEAD",
      },
    });
  }

  // Edge Cache: check cache first
  const cache = caches.default;
  const cacheKey = new Request(request.url, { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  // Fetch from upstream Cloud Function
  const targetUrl = buildTeamShareOgUrl(request.url);
  const upstream = await fetch(targetUrl.toString(), {
    method: request.method,
    headers: request.headers,
    redirect: "follow",
  });

  // Only cache successful responses
  if (upstream.ok) {
    const response = new Response(upstream.body, upstream);
    response.headers.set("Cache-Control", `public, max-age=${EDGE_CACHE_TTL}, s-maxage=${EDGE_CACHE_TTL}`);
    // Store in edge cache (non-blocking)
    request.method === "GET" && cache.put(cacheKey, response.clone());
    return response;
  }

  return new Response(upstream.body, upstream);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (isTeamSharePath(url.pathname)) {
      return handleTeamShare(request);
    }

    if (env && env.ASSETS && typeof env.ASSETS.fetch === "function") {
      return env.ASSETS.fetch(request);
    }
    return fetch(request);
  },
};
