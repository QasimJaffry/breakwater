import type { Snapshot } from "@breakwater/collector";
import type { Change } from "./diff";
import { isChildOf } from "./diff";
import { routeShape, type SpecFields } from "./openapi";

export interface VersionRef { platform: string; version: string; installs: number }
export interface Impact extends Change { readBy: VersionRef[]; installs: number; share: number }
export interface ImpactReport {
  totalInstalls: number;
  windowDays: number;
  breaking: Impact[]; // read by at least one active version
  harmless: Impact[]; // nobody in the window reads it
  affectedInstalls: number; // union across all breaking changes
  affectedShare: number;
}

const semverCmp = (a: string, b: string) => {
  const pa = a.split(/[.+-]/).map((x) => (/^\d+$/.test(x) ? +x : x)), pb = b.split(/[.+-]/).map((x) => (/^\d+$/.test(x) ? +x : x));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    return String(x) < String(y) ? -1 : 1;
  }
  return 0;
};
export const sortVersions = (v: VersionRef[]) =>
  [...v].sort((a, b) => a.platform.localeCompare(b.platform) || semverCmp(a.version, b.version));

/** Merge usage routes onto spec route shapes: `GET /orders/:id` + `GET /orders/:orderId` -> `GET /orders/:*`. */
export function usageByShape(snap: Snapshot): Map<string, Map<string, Set<string>>> {
  const out = new Map<string, Map<string, Set<string>>>();
  for (const [route, paths] of Object.entries(snap.usage)) {
    const shape = routeShape(route);
    const m = out.get(shape) ?? new Map<string, Set<string>>();
    for (const [p, vs] of Object.entries(paths)) {
      const s = m.get(p) ?? new Set<string>();
      vs.forEach((v) => s.add(v));
      m.set(p, s);
    }
    out.set(shape, m);
  }
  return out;
}

export function assess(changes: Change[], snap: Snapshot): ImpactReport {
  const usage = usageByShape(snap);
  const installs = new Map(snap.versions.map((v) => [`${v.platform}@${v.version}`, v]));
  const total = snap.versions.reduce((s, v) => s + v.installs, 0);
  const breaking: Impact[] = [], harmless: Impact[] = [];
  const allAffected = new Set<string>();

  for (const c of changes) {
    const routeUsage = usage.get(c.route);
    const readers = new Set<string>();
    if (routeUsage) {
      for (const [p, vs] of routeUsage) {
        const hit = c.kind === "route_removed" || p === c.path || isChildOf(p, c.path);
        if (hit) vs.forEach((v) => readers.add(v));
      }
      // removing a whole endpoint also breaks clients that call it but read nothing (e.g. fire-and-forget)
    }
    const readBy = sortVersions([...readers].map((k) => installs.get(k)).filter((v): v is VersionRef => !!v));
    const n = readBy.reduce((s, v) => s + v.installs, 0);
    const item: Impact = { ...c, readBy, installs: n, share: total ? n / total : 0 };
    (readBy.length ? breaking : harmless).push(item);
    readBy.forEach((v) => allAffected.add(`${v.platform}@${v.version}`));
  }
  breaking.sort((a, b) => b.installs - a.installs || a.route.localeCompare(b.route));
  const affectedInstalls = [...allAffected].reduce((s, k) => s + (installs.get(k)?.installs ?? 0), 0);
  return { totalInstalls: total, windowDays: snap.windowDays, breaking, harmless, affectedInstalls, affectedShare: total ? affectedInstalls / total : 0 };
}

/** Fields the spec still returns that no active version has read in the window. */
export function unusedFields(spec: SpecFields, snap: Snapshot): { route: string; path: string }[] {
  const usage = usageByShape(snap);
  const out: { route: string; path: string }[] = [];
  for (const [route, fields] of spec) {
    const u = usage.get(route);
    const paths = [...fields.keys()].filter((p) => p !== "");
    for (const p of paths) {
      const used = u && [...u.keys()].some((q) => q === p || isChildOf(q, p));
      // only report the top-most unused path
      if (!used && !paths.some((q) => q !== p && isChildOf(p, q) && !(u && [...u.keys()].some((r) => r === q || isChildOf(r, q))))) {
        out.push({ route, path: p });
      }
    }
  }
  return out;
}
