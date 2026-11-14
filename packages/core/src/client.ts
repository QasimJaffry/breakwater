import { Recorder, newInstallId, type AppInfo, type UsageReport } from "./recorder";
import type { RouteMatcher } from "./route";
import { wrapFetch } from "./fetch";

export interface KeyValueStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
}

export interface ClientOptions {
  /** Collector base URL, e.g. https://bw.example.com */
  endpoint: string;
  app: AppInfo;
  ingestKey?: string;
  routes?: (string | RouteMatcher)[];
  /** Only track responses whose URL passes (default: every URL). Use it to skip third-party APIs. */
  filter?: (url: string) => boolean;
  sampleRate?: number;
  flushIntervalMs?: number; // default 60s
  storage?: KeyValueStorage;
  /** Platform hook: call `flush` when the app goes to the background / page hides. Returns an unsubscribe. */
  onBackground?: (flush: () => void) => () => void;
  /** Platform transport. Default: fetch with keepalive. */
  send?: (url: string, body: string, headers: Record<string, string>) => Promise<boolean>;
  fetchImpl?: typeof fetch;
  setIntervalImpl?: (fn: () => void, ms: number) => unknown;
  clearIntervalImpl?: (h: unknown) => void;
}

export interface BreakwaterClient {
  fetch: typeof fetch;
  /** Wrap a JSON value you parsed yourself (axios, GraphQL clients, websockets...). */
  observe<T>(method: string, url: string, body: T): T;
  flush(): Promise<void>;
  stop(): void;
}

const ID_KEY = "breakwater.installId";

export async function createClient(opts: ClientOptions): Promise<BreakwaterClient> {
  let installId = (await opts.storage?.getItem(ID_KEY)) ?? null;
  if (!installId || !/^[0-9a-f]{32}$/.test(installId)) {
    installId = newInstallId();
    await opts.storage?.setItem(ID_KEY, installId);
  }
  const recorder = new Recorder({ app: opts.app, installId, routes: opts.routes, sampleRate: opts.sampleRate });
  const base = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const url = `${opts.endpoint.replace(/\/$/, "")}/v1/reports`;
  const headers: Record<string, string> = { "content-type": "application/json", ...(opts.ingestKey ? { "x-breakwater-key": opts.ingestKey } : {}) };
  const send =
    opts.send ??
    (async (u: string, body: string, h: Record<string, string>) => {
      try { return (await base(u, { method: "POST", body, headers: h, keepalive: true })).ok; } catch { return false; }
    });

  let inFlight: Promise<void> | null = null;
  const flush = () => {
    if (inFlight) return inFlight;
    const report: UsageReport | null = recorder.drain();
    if (!report) return Promise.resolve();
    inFlight = send(url, JSON.stringify(report), headers)
      .then((ok) => { if (!ok) recorder.retry(); })
      .catch(() => recorder.retry())
      .finally(() => { inFlight = null; });
    return inFlight;
  };

  const timer = (opts.setIntervalImpl ?? setInterval)(() => void flush(), opts.flushIntervalMs ?? 60_000);
  const unsub = opts.onBackground?.(() => void flush());
  const own = (u: string) => !u.startsWith(opts.endpoint) && (!opts.filter || opts.filter(u));

  return {
    fetch: wrapFetch(base, recorder, own),
    observe: (m, u, b) => recorder.observe(m, u, b),
    flush,
    stop() { (opts.clearIntervalImpl ?? clearInterval)(timer as any); unsub?.(); },
  };
}
