/** Turn a concrete request into a stable route key, e.g. `GET /orders/:id`. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const looksLikeId = (seg: string) =>
  /^\d+$/.test(seg) || UUID.test(seg) || /^[0-9a-f]{16,}$/i.test(seg) || (/^[A-Za-z0-9_-]{20,}$/.test(seg) && /\d/.test(seg));

export interface RouteMatcher {
  method?: string;
  pattern: string; // "/orders/:id/items"
}

function matches(pattern: string, path: string): boolean {
  const a = pattern.split("/").filter(Boolean), b = path.split("/").filter(Boolean);
  return a.length === b.length && a.every((s, i) => s.startsWith(":") || s === "*" || s === b[i]);
}

export function routeKey(method: string, url: string, patterns: (string | RouteMatcher)[] = []): string {
  const m = (method || "GET").toUpperCase();
  let path: string;
  try {
    path = new URL(url, "http://x").pathname;
  } catch {
    path = url.split("?")[0] ?? url;
  }
  path = path.replace(/\/{2,}/g, "/").replace(/(.)\/$/, "$1");
  for (const p of patterns) {
    const pm = typeof p === "string" ? { pattern: p } : p;
    if ((!pm.method || pm.method.toUpperCase() === m) && matches(pm.pattern, path)) return `${m} ${pm.pattern}`;
  }
  const norm = path.split("/").map((s) => (s && looksLikeId(decodeURIComponent(s)) ? ":id" : s)).join("/");
  return `${m} ${norm || "/"}`;
}
