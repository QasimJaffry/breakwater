import { DatabaseSync } from "node:sqlite";
import type { Snapshot } from "./snapshot";

export interface IncomingReport {
  schema: 1;
  app: { version: string; platform: string; build?: string };
  installId: string;
  routes: Record<string, string[]>;
}

const LIMITS = { routes: 500, pathsPerRoute: 2000, pathLen: 300, field: 64 };
const SAFE = /^[\w.\-+@:\/ \[\]{}$]*$/;

export class ReportError extends Error {}

/** Validate untrusted input strictly: the collector is reachable from every installed app. */
export function validateReport(x: unknown): IncomingReport {
  const bad = (m: string): never => { throw new ReportError(m); };
  if (!x || typeof x !== "object") bad("body must be an object");
  const r = x as Record<string, any>;
  if (r.schema !== 1) bad("unsupported schema");
  const str = (v: unknown, name: string, max = LIMITS.field) =>
    typeof v === "string" && v.length > 0 && v.length <= max && SAFE.test(v) ? v : bad(`invalid ${name}`);
  str(r.app?.version, "app.version"); str(r.app?.platform, "app.platform");
  if (!/^[0-9a-f]{16,64}$/i.test(String(r.installId ?? ""))) bad("invalid installId");
  if (!r.routes || typeof r.routes !== "object" || Array.isArray(r.routes)) bad("routes must be an object");
  const entries = Object.entries(r.routes);
  if (entries.length > LIMITS.routes) bad("too many routes");
  for (const [route, paths] of entries) {
    str(route, "route", LIMITS.pathLen);
    if (!Array.isArray(paths) || paths.length > LIMITS.pathsPerRoute) bad(`invalid paths for ${route}`);
    for (const p of paths as unknown[]) str(p, "path", LIMITS.pathLen);
  }
  return { schema: 1, app: { version: r.app.version, platform: r.app.platform.toLowerCase() }, installId: r.installId, routes: r.routes };
}

export class Store {
  readonly db: DatabaseSync;
  constructor(file = ":memory:", private now: () => Date = () => new Date()) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS usage (
        route TEXT NOT NULL, path TEXT NOT NULL, platform TEXT NOT NULL, version TEXT NOT NULL,
        first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
        PRIMARY KEY (route, path, platform, version)
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS installs (
        install_id TEXT PRIMARY KEY, platform TEXT NOT NULL, version TEXT NOT NULL, last_seen TEXT NOT NULL
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS installs_seen ON installs(last_seen);
      CREATE INDEX IF NOT EXISTS usage_seen ON usage(last_seen);
    `);
  }

  ingest(report: IncomingReport): void {
    const t = this.now().toISOString();
    const { platform, version } = report.app;
    const up = this.db.prepare(
      `INSERT INTO usage VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(route, path, platform, version) DO UPDATE SET last_seen = excluded.last_seen`,
    );
    this.db.exec("BEGIN");
    try {
      for (const [route, paths] of Object.entries(report.routes)) for (const p of paths) up.run(route, p, platform, version, t, t);
      // an install that updated the app moves to its new version
      this.db
        .prepare(`INSERT INTO installs VALUES (?, ?, ?, ?) ON CONFLICT(install_id) DO UPDATE SET platform = excluded.platform, version = excluded.version, last_seen = excluded.last_seen`)
        .run(report.installId, platform, version, t);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  snapshot(windowDays = 30): Snapshot {
    const now = this.now();
    const since = new Date(now.getTime() - windowDays * 864e5).toISOString();
    const versions = this.db
      .prepare(`SELECT platform, version, COUNT(*) AS installs FROM installs WHERE last_seen >= ? GROUP BY platform, version ORDER BY platform, version`)
      .all(since) as { platform: string; version: string; installs: number }[];
    const rows = this.db
      .prepare(`SELECT route, path, platform, version FROM usage WHERE last_seen >= ? ORDER BY route, path, platform, version`)
      .all(since) as { route: string; path: string; platform: string; version: string }[];
    const usage: Snapshot["usage"] = {};
    for (const r of rows) ((usage[r.route] ??= {})[r.path] ??= []).push(`${r.platform}@${r.version}`);
    return { schema: 1, generatedAt: now.toISOString(), windowDays, versions: versions.map((v) => ({ ...v, installs: Number(v.installs) })), usage };
  }
}
