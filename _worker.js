const TEAM_SHARE_PATH = "/team-share";
const EVENT_SHARE_PATH = "/event-share";
const OG_FUNCTION_ORIGIN = "https://asia-east1-fc-football-6c8dc.cloudfunctions.net";
const TEAM_SHARE_OG_PATH = "/teamShareOg";
const EVENT_SHARE_OG_PATH = "/eventShareOg";
const RUNTIME_CONFIG_PATH = "/runtime-config.json";
const RUNTIME_CONFIG_FUNCTION_PATH = "/runtimeConfig";
const EDGE_CACHE_TTL = 300; // 5 minutes
const LIST_SPA_PATHS = new Set(["/activities", "/teams", "/tournaments", "/profile"]);
const DETAIL_SPA_ROOTS = new Set(["events", "teams", "tournaments"]);
const OPS_REPORT_PATHS = new Set(["/ops-report", "/ops-report.html"]);
const SAFE_SEGMENT_RE = /^[A-Za-z0-9_-]{3,80}$/;

function isTeamSharePath(pathname) {
  return pathname === TEAM_SHARE_PATH || pathname.startsWith(`${TEAM_SHARE_PATH}/`);
}

function isEventSharePath(pathname) {
  return pathname === EVENT_SHARE_PATH || pathname.startsWith(`${EVENT_SHARE_PATH}/`);
}

function isOpsReportPath(pathname) {
  return OPS_REPORT_PATHS.has(stripTrailingSlash(pathname));
}

function isRuntimeConfigPath(pathname) {
  return stripTrailingSlash(pathname) === RUNTIME_CONFIG_PATH;
}

function buildTeamShareOgUrl(requestUrl) {
  const incoming = new URL(requestUrl);
  const suffix = incoming.pathname.slice(TEAM_SHARE_PATH.length);
  const target = new URL(OG_FUNCTION_ORIGIN);
  target.pathname = `${TEAM_SHARE_OG_PATH}${suffix}`;
  target.search = incoming.search;
  return target;
}

function buildEventShareOgUrl(requestUrl) {
  const incoming = new URL(requestUrl);
  const suffix = incoming.pathname.slice(EVENT_SHARE_PATH.length);
  const target = new URL(OG_FUNCTION_ORIGIN);
  target.pathname = `${EVENT_SHARE_OG_PATH}${suffix}`;
  target.search = incoming.search;
  return target;
}

async function handleOgShare(request, buildUrlFn) {
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
  const targetUrl = buildUrlFn(request.url);
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

function stripTrailingSlash(pathname) {
  if (!pathname || pathname === "/") return "/";
  return pathname.replace(/\/+$/, "") || "/";
}

function isSafeRouteSegment(segment) {
  if (!segment || segment === "." || segment === "..") return false;
  if (/%2f|%5c/i.test(segment)) return false;
  try {
    const decoded = decodeURIComponent(segment);
    if (decoded.includes("/") || decoded.includes("\\")) return false;
    return SAFE_SEGMENT_RE.test(decoded);
  } catch (_) {
    return false;
  }
}

function getSpaRouteKind(pathname) {
  const path = stripTrailingSlash(pathname);
  if (LIST_SPA_PATHS.has(path)) return "list";
  const segments = path.split("/").filter(Boolean);
  if (segments.length !== 2) return "";
  if (!DETAIL_SPA_ROOTS.has(segments[0])) return "";
  return isSafeRouteSegment(segments[1]) ? "detail" : "";
}

async function fetchAsset(request, env) {
  if (env && env.ASSETS && typeof env.ASSETS.fetch === "function") {
    const incoming = new URL(request.url);
    const assetUrl = new URL("https://assets.local/");
    assetUrl.pathname = incoming.pathname === "/" ? "/index.html" : incoming.pathname;
    assetUrl.search = "";
    const assetRequest = new Request(assetUrl.toString(), {
      method: request.method,
      headers: request.headers,
      redirect: "follow",
    });
    return env.ASSETS.fetch(assetRequest);
  }
  return fetch(request);
}

async function handleSpaFallback(request, env, _routeKind) {
  if (!["GET", "HEAD"].includes(request.method)) {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { "Allow": "GET, HEAD" },
    });
  }

  const indexUrl = new URL(request.url);
  indexUrl.pathname = "/index.html";
  indexUrl.search = "";
  indexUrl.hash = "";
  const indexRequest = new Request(indexUrl.toString(), {
    method: request.method,
    headers: request.headers,
    redirect: "follow",
  });
  const upstream = await fetchAsset(indexRequest, env);
  const response = new Response(upstream.body, upstream);
  response.headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  // Phase 5.5 (2026-05-11): detail SPA path noindex 暫時保護已移除，改由動態 canonical
  // (App._updateRouteMetaTags) 指向正確 detail URL，搭配 sitemap 開放 Google 索引。
  return response;
}

async function handleOpsReport(request, env) {
  if (!["GET", "HEAD"].includes(request.method)) {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { "Allow": "GET, HEAD" },
    });
  }

  const reportUrl = new URL(request.url);
  reportUrl.pathname = "/ops-report.html";
  reportUrl.search = "";
  reportUrl.hash = "";
  const reportRequest = new Request(reportUrl.toString(), {
    method: request.method,
    headers: request.headers,
    redirect: "follow",
  });
  const upstream = await fetchAsset(reportRequest, env);
  const response = new Response(upstream.body, upstream);
  response.headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return response;
}

async function handleRuntimeConfig(request) {
  if (!["GET", "HEAD"].includes(request.method)) {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { "Allow": "GET, HEAD" },
    });
  }

  const target = new URL(OG_FUNCTION_ORIGIN);
  target.pathname = RUNTIME_CONFIG_FUNCTION_PATH;
  const upstream = await fetch(target.toString(), {
    method: request.method,
    headers: {
      "Accept": "application/json",
      "X-ToosterX-Edge": "runtime-config",
    },
    redirect: "follow",
  }).catch(() => null);

  const response = upstream && upstream.ok
    ? new Response(upstream.body, upstream)
    : new Response("{}", { status: 200 });
  response.headers.set("Content-Type", "application/json; charset=utf-8");
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return response;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (isRuntimeConfigPath(url.pathname)) {
      return handleRuntimeConfig(request);
    }
    if (isOpsReportPath(url.pathname)) {
      return handleOpsReport(request, env);
    }
    if (isTeamSharePath(url.pathname)) {
      return handleOgShare(request, buildTeamShareOgUrl);
    }
    if (isEventSharePath(url.pathname)) {
      return handleOgShare(request, buildEventShareOgUrl);
    }

    const spaRouteKind = getSpaRouteKind(url.pathname);
    if (spaRouteKind) {
      return handleSpaFallback(request, env, spaRouteKind);
    }
    return fetchAsset(request, env);
  },
};
