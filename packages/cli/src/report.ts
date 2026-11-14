import type { ImpactReport, Impact, VersionRef } from "./impact";

const pct = (x: number) => (x === 0 ? "0%" : x < 0.001 ? "<0.1%" : `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`);
const num = (n: number) => n.toLocaleString("en-US");

/** "ios 4.2.0–4.5.1, android 4.4.0" (contiguous runs within the active version list collapse to ranges) */
export function versionRanges(readBy: VersionRef[], all: VersionRef[]): string {
  const parts: string[] = [];
  for (const platform of [...new Set(readBy.map((v) => v.platform))]) {
    const ordered = all.filter((v) => v.platform === platform);
    const hit = new Set(readBy.filter((v) => v.platform === platform).map((v) => v.version));
    const runs: string[] = [];
    let start: string | null = null, prev: string | null = null;
    for (const v of [...ordered, { version: "\u0000" } as VersionRef]) {
      if (hit.has(v.version)) { start ??= v.version; prev = v.version; continue; }
      if (start) runs.push(start === prev ? start : `${start}–${prev}`);
      start = prev = null;
    }
    parts.push(`${platform} ${runs.join(", ")}`);
  }
  return parts.join("; ");
}

const label: Record<Impact["kind"], string> = {
  route_removed: "Endpoint removed", field_removed: "Removed", type_changed: "Type changed",
  now_nullable: "Now nullable", now_optional: "Now optional",
};

export function toMarkdown(r: ImpactReport, all: VersionRef[]): string {
  const L: string[] = [];
  const nb = r.breaking.length;
  if (!nb) {
    L.push(`### 🌊 Breakwater: no active app version reads anything this change breaks`);
  } else {
    L.push(`### 🌊 Breakwater: ${nb} breaking change${nb > 1 ? "s" : ""} reach **${pct(r.affectedShare)} of active installs** (${num(r.affectedInstalls)} of ${num(r.totalInstalls)})`);
    L.push("", "| Change | Field | Read by | Installs |", "|---|---|---|---:|");
    for (const b of r.breaking) {
      const field = b.kind === "route_removed" ? `\`${b.route}\`` : `\`${b.route}\` → \`${b.path}\``;
      const what = b.kind === "type_changed" ? `${label[b.kind]} (${b.detail})` : label[b.kind];
      L.push(`| ${what} | ${field} | ${versionRanges(b.readBy, all)} | ${num(b.installs)} (${pct(b.share)}) |`);
    }
  }
  if (r.harmless.length) {
    L.push("", `<details><summary>${r.harmless.length} other change${r.harmless.length > 1 ? "s" : ""} touch fields no active version read in the last ${r.windowDays} days</summary>`, "");
    for (const h of r.harmless) L.push(`- ${label[h.kind]}: \`${h.route}\`${h.path ? ` → \`${h.path}\`` : ""}`);
    L.push("", "</details>");
  }
  L.push("", `<sub>Based on field reads observed from ${num(r.totalInstalls)} active installs over ${r.windowDays} days. A field read only on screens nobody opened in that window looks unused: treat "not read" as strong evidence, not proof.</sub>`);
  return L.join("\n");
}
