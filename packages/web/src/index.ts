import { createClient, type ClientOptions, type BreakwaterClient } from "@breakwater/core";

/**
 * Browser preset: install id in localStorage, flush on page hide via sendBeacon (survives navigation).
 *
 *   const bw = await initBreakwater({ endpoint: "https://bw.example.com", app: { version: "2026.11.3", platform: "web" } });
 *   const res = await bw.fetch("/api/orders/42");   // or: window.fetch = bw.fetch
 */
export function initBreakwater(opts: Omit<ClientOptions, "storage" | "onBackground">): Promise<BreakwaterClient> {
  const storage = (() => {
    try { const ls = globalThis.localStorage; ls.getItem("x"); return ls; } catch { return undefined; }
  })();
  return createClient({
    storage,
    onBackground: (flush) => {
      const h = () => { if (document.visibilityState === "hidden") flush(); };
      document.addEventListener("visibilitychange", h);
      window.addEventListener("pagehide", flush);
      return () => { document.removeEventListener("visibilitychange", h); window.removeEventListener("pagehide", flush); };
    },
    send: async (url, body, headers) => {
      // sendBeacon cannot set custom headers, so it is only used when no ingest key is configured
      if (!headers["x-breakwater-key"] && navigator.sendBeacon?.(url, new Blob([body], { type: "application/json" }))) return true;
      try { return (await fetch(url, { method: "POST", body, headers, keepalive: true })).ok; } catch { return false; }
    },
    ...opts,
  });
}
export * from "@breakwater/core";
