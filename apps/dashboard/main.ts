import data from "../../examples/eats/out/dashboard-data.json";

type V = { platform: string; version: string; installs: number };
const snap = data.snapshot as { versions: V[]; usage: Record<string, Record<string, string[]>>; windowDays: number };
const report = data.report as any;
const spec = data.spec as Record<string, Record<string, { types: string[]; nullable: boolean; required: boolean }>>;
const unused = new Set((data.unused as { route: string; path: string }[]).map((u) => `${u.route}|${u.path}`));

const shape = (r: string) => r.replace(/\{[^}]+\}|:[A-Za-z_]\w*/g, ":*");
const usage: Record<string, Record<string, Set<string>>> = {};
for (const [r, paths] of Object.entries(snap.usage)) {
  const m = (usage[shape(r)] ??= {});
  for (const [p, vs] of Object.entries(paths)) vs.forEach((v) => (m[p] ??= new Set()).add(v));
}
const cmp = (a: string, b: string) => {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};
const versions = [...snap.versions].sort((a, b) => a.platform.localeCompare(b.platform) || cmp(a.version, b.version));
const total = versions.reduce((s, v) => s + v.installs, 0);
const key = (v: V) => `${v.platform}@${v.version}`;
const PLAT: Record<string, string> = { ios: "#7aa2ff", android: "#5fd39a", web: "#c99bff" };
const breaking = new Map<string, any>();
for (const b of report.breaking) breaking.set(`${b.route}|${b.path}`, b);
const harmlessKeys = new Set(report.harmless.map((h: any) => `${h.route}|${h.path}`));
const isChild = (c: string, p: string) => (p === "" ? c !== "" : c.startsWith(p + ".") || c.startsWith(p + "[]"));
const pct = (x: number) => (x === 0 ? "0%" : x < 0.01 ? "<1%" : `${Math.round(x * 100)}%`);
const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

let route = Object.keys(spec).find((r) => r.includes("orders")) ?? Object.keys(spec)[0]!;
let focus: string | null = null;

function renderHeader() {
  $("kpi-breaking").textContent = String(report.breaking.length);
  $("kpi-share").textContent = pct(report.affectedShare);
  $("kpi-installs").textContent = total.toLocaleString("en-US");
  $("kpi-unused").textContent = String(unused.size);
  $("window").textContent = `${snap.windowDays} days`;
  // adoption strip
  $("strip").innerHTML = versions.map((v) => `<div class="seg" style="flex:${v.installs};--c:${PLAT[v.platform] ?? "#aaa"}" title="${v.platform} ${v.version}: ${v.installs} installs (${pct(v.installs / total)})"><span>${v.platform === "android" ? "Android" : v.platform === "ios" ? "iOS" : "Web"} ${v.version}</span></div>`).join("");
}

function renderPr() {
  const rows = report.breaking.map((b: any) => {
    const k = `${b.route}|${b.path}`;
    const kind = { field_removed: "Removed", type_changed: `Type ${b.detail}`, now_nullable: "Now nullable", now_optional: "Now optional", route_removed: "Endpoint removed" }[b.kind as string];
    return `<button class="prrow ${focus === k ? "on" : ""}" data-k="${esc(k)}">
      <span class="kind">${esc(kind)}</span>
      <code>${esc(b.route.replace(":*", ":id"))}${b.path ? ` → ${esc(b.path)}` : ""}</code>
      <span class="vers">${b.readBy.map((v: V) => `<i style="--c:${PLAT[v.platform]}">${v.platform === "ios" ? "iOS" : v.platform === "android" ? "Android" : "Web"} ${v.version}</i>`).join("")}</span>
      <span class="share"><b>${pct(b.share)}</b><small>${b.installs.toLocaleString("en-US")} installs</small></span>
    </button>`;
  });
  const harmless = report.harmless.map((h: any) => `<li><code>${esc(h.route.replace(":*", ":id"))}${h.path ? ` → ${esc(h.path)}` : ""}</code> <span>no active version reads it</span></li>`);
  $("pr").innerHTML = rows.join("") + (harmless.length ? `<div class="safe"><h4>✓ Safe in this PR</h4><ul>${harmless.join("")}</ul></div>` : "");
  $("pr").querySelectorAll<HTMLButtonElement>(".prrow").forEach((b) => (b.onclick = () => {
    const k = b.dataset.k!;
    focus = focus === k ? null : k;
    if (focus) route = k.split("|")[0]!;
    render();
    document.querySelector(".row.focus")?.scrollIntoView({ block: "center", behavior: "smooth" });
  }));
}

function renderTabs() {
  $("tabs").innerHTML = Object.keys(spec).map((r) => {
    const n = report.breaking.filter((b: any) => b.route === r).length;
    return `<button class="tab ${r === route ? "on" : ""}" data-r="${esc(r)}">${esc(r.replace(":*", ":id"))}${n ? `<em>${n}</em>` : ""}</button>`;
  }).join("");
  $("tabs").querySelectorAll<HTMLButtonElement>(".tab").forEach((b) => (b.onclick = () => { route = b.dataset.r!; focus = null; render(); }));
}

function renderGrid() {
  const fields = spec[route] ?? {};
  const u = usage[route] ?? {};
  const paths = Object.keys(fields).filter((p) => p !== "").sort();
  const readersOf = (p: string) => {
    const s = new Set<string>();
    for (const [q, vs] of Object.entries(u)) if (q === p || isChild(q, p)) vs.forEach((v) => s.add(v));
    return s;
  };
  const head = `<div class="row head"><div class="f">Field</div>${versions.map((v) => `<div class="c" style="--c:${PLAT[v.platform]}"><span>${v.platform === "ios" ? "iOS" : v.platform === "android" ? "And" : "Web"}</span><b>${v.version}</b></div>`).join("")}<div class="r">Active installs reading</div></div>`;
  const body = paths.map((p) => {
    const k = `${route}|${p}`;
    const readers = readersOf(p);
    const n = versions.filter((v) => readers.has(key(v))).reduce((s, v) => s + v.installs, 0);
    const depth = (p.match(/\.|\[\]/g) ?? []).length;
    const leaf = p.split(/\.|(?=\[\])/).pop()!;
    const b = breaking.get(k);
    const flags = [
      b ? `<span class="flag bad">breaks in PR</span>` : "",
      harmlessKeys.has(k) ? `<span class="flag ok">changed in PR, unread</span>` : "",
      unused.has(k) && !harmlessKeys.has(k) ? `<span class="flag dim">safe to remove</span>` : "",
    ].join("");
    const typ = fields[p]!.types.join("|") + (fields[p]!.nullable ? "?" : "");
    return `<div class="row ${focus === k ? "focus" : ""} ${b ? "bad" : ""} ${readers.size ? "" : "cold"}">
      <div class="f" style="padding-left:${12 + depth * 16}px"><code>${esc(leaf)}</code><small>${esc(typ)}</small>${flags}</div>
      ${versions.map((v) => `<div class="c">${readers.has(key(v)) ? `<i style="--c:${PLAT[v.platform]}" title="${v.platform} ${v.version} reads ${esc(p)}"></i>` : "<s></s>"}</div>`).join("")}
      <div class="r"><div class="bar"><i style="width:${(100 * n) / total}%"></i></div><span>${pct(n / total)}</span></div>
    </div>`;
  });
  $("grid").innerHTML = head + body.join("");
}

function render() { renderPr(); renderTabs(); renderGrid(); }
renderHeader(); render();
