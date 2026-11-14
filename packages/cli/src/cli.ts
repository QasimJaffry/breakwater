import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { Snapshot } from "@breakwater/collector";
import { flattenSpec } from "./openapi";
import { diffSpecs } from "./diff";
import { assess, unusedFields, sortVersions } from "./impact";
import { toMarkdown } from "./report";

const HELP = `breakwater check  --old <openapi.json> --new <openapi.json> (--snapshot <file> | --collector <url>) [--fail-above 0] [--out report.md] [--json]
breakwater unused --spec <openapi.json> (--snapshot <file> | --collector <url>)

Exit codes: 0 ok, 1 breaking changes above --fail-above (fraction of active installs), 2 usage error.`;

async function loadSnapshot(v: { snapshot?: string; collector?: string; days?: string }): Promise<Snapshot> {
  if (v.snapshot) return JSON.parse(readFileSync(v.snapshot, "utf8"));
  if (v.collector) {
    const res = await fetch(`${v.collector.replace(/\/$/, "")}/v1/snapshot?days=${v.days ?? 30}`, {
      headers: process.env.BREAKWATER_READ_KEY ? { "x-breakwater-key": process.env.BREAKWATER_READ_KEY } : {},
    });
    if (!res.ok) throw new Error(`collector returned ${res.status}`);
    return (await res.json()) as Snapshot;
  }
  throw new Error("pass --snapshot or --collector");
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const { values: v } = parseArgs({
    args: rest,
    options: {
      old: { type: "string" }, new: { type: "string" }, spec: { type: "string" },
      snapshot: { type: "string" }, collector: { type: "string" }, days: { type: "string" },
      "fail-above": { type: "string" }, out: { type: "string" }, json: { type: "boolean" },
    },
  });
  const read = (f?: string) => { if (!f) throw new Error("missing spec path"); return JSON.parse(readFileSync(f, "utf8")); };
  try {
    if (cmd === "check") {
      const snap = await loadSnapshot(v);
      const report = assess(diffSpecs(flattenSpec(read(v.old)), flattenSpec(read(v.new))), snap);
      const md = toMarkdown(report, sortVersions(snap.versions));
      if (v.out) writeFileSync(v.out, md);
      console.log(v.json ? JSON.stringify(report, null, 2) : md);
      const limit = Number(v["fail-above"] ?? 0);
      return report.affectedShare > limit ? 1 : 0;
    }
    if (cmd === "unused") {
      const snap = await loadSnapshot(v);
      const rows = unusedFields(flattenSpec(read(v.spec)), snap);
      console.log(v.json ? JSON.stringify(rows, null, 2) : rows.map((r) => `${r.route}  ${r.path}`).join("\n") || "every returned field is read by some active version");
      return 0;
    }
    console.log(HELP);
    return cmd ? 2 : 0;
  } catch (e) {
    console.error(`breakwater: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
}
