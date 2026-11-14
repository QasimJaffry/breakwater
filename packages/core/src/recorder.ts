import { track } from "./track";
import { routeKey, type RouteMatcher } from "./route";

export interface AppInfo {
  version: string; // marketing version, e.g. "4.2.0"
  platform: string; // "ios" | "android" | "web" | ...
  build?: string;
}

/** What leaves the device. Paths only: no values, no URLs with ids, no headers. */
export interface UsageReport {
  schema: 1;
  app: AppInfo;
  installId: string; // random per install; used only to count active installs per version
  sentAt: string;
  routes: Record<string, string[]>; // "GET /orders/:id" -> ["id", "courier.phone", "items[].price"]
}

export interface RecorderOptions {
  app: AppInfo;
  installId: string;
  routes?: (string | RouteMatcher)[];
  /** 0..1, chance a given response is tracked. Default 1. Reads from untracked responses are not seen. */
  sampleRate?: number;
  /** Paths deeper than this are cut (guards against runaway recursive data). Default 12. */
  maxDepth?: number;
  random?: () => number;
}

export class Recorder {
  private seen = new Map<string, Set<string>>();
  private dirty = false;
  constructor(private opts: RecorderOptions) {}

  /** Wrap a parsed JSON body for the given request. Returns the value to hand to app code. */
  observe<T>(method: string, url: string, body: T): T {
    const rate = this.opts.sampleRate ?? 1;
    if (rate < 1 && (this.opts.random ?? Math.random)() >= rate) return body;
    const key = routeKey(method, url, this.opts.routes);
    const maxDepth = this.opts.maxDepth ?? 12;
    return track(body, (path) => {
      if (path.split(/\.|\[\]/).length - 1 > maxDepth) return;
      let set = this.seen.get(key);
      if (!set) this.seen.set(key, (set = new Set()));
      if (!set.has(path)) {
        set.add(path);
        this.dirty = true;
      }
    });
  }

  /** Build a report of everything read since the last successful flush; null if nothing new. */
  drain(now = new Date()): UsageReport | null {
    if (!this.dirty) return null;
    const routes: Record<string, string[]> = {};
    for (const [k, v] of this.seen) routes[k] = [...v].sort();
    this.dirty = false;
    return { schema: 1, app: this.opts.app, installId: this.opts.installId, sentAt: now.toISOString(), routes };
  }

  /** Mark everything as unsent again (e.g. the transport failed). */
  retry(): void {
    if (this.seen.size) this.dirty = true;
  }
}

/** Dependency-free random install id (not derived from anything about the user or device). */
export function newInstallId(random: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < 32; i++) s += Math.floor(random() * 16).toString(16);
  return s;
}
