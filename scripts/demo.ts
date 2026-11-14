/**
 * End-to-end demo with simulated traffic. Every number in the output is computed by Breakwater from
 * what the simulated app versions actually read through the real SDK and collector; the only made-up
 * inputs are the install counts per version and which screens each simulated user opens.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createClient } from "@breakwater/core";
import { Store, createCollector } from "@breakwater/collector";
import { flattenSpec, diffSpecs, assess, unusedFields, toMarkdown, sortVersions } from "@breakwater/cli";

// seeded RNG so the demo is reproducible
let seed = 20261114;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

// ── a fake Eats API ──────────────────────────────────────────────────────────────────────────
const api: typeof fetch = async (input) => {
  const u = new URL(String(input));
  const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { "content-type": "application/json" } });
  if (u.pathname.startsWith("/orders/")) return json({
    id: u.pathname.split("/")[2], status: "on_the_way", eta: 14, total: 2350, legacyTip: 0,
    courier: { name: "Bilal", phone: "+92 300 0000000", vehicle: "bike", location: { lat: 31.52, lng: 74.35 } },
    items: [{ name: "Chicken karahi", qty: 1, price: 1800 }, { name: "Naan", qty: 2, price: 275, notes: "extra butter" }],
  });
  if (u.pathname === "/restaurants") return json([
    { id: "r1", name: "Butt Karahi", rating: 4.6, cuisine: "desi", deliveryFee: 99 },
    { id: "r2", name: "Cafe Aylanto", rating: 4.4, cuisine: "continental", deliveryFee: 149 },
  ]);
  if (u.pathname === "/me") return json({ id: "u1", name: "Qasim", email: "q@example.com", avatarUrl: "https://x/y.png", loyalty: { points: 1200, tier: "gold" } });
  if (u.pathname === "/promos/legacy") return json({ code: "EID50", banner: "..." });
  return new Response("not found", { status: 404 });
};
const API = "https://api.eats.test";

// ── what each shipped app version's screens read (this is "the app code") ────────────────────────
type Screens = Record<string, (f: typeof fetch) => Promise<unknown>>;
const get = async (f: typeof fetch, p: string) => (await f(API + p)).json() as Promise<any>;

const v4: Screens = {
  orderTracking: async (f) => {
    const o = await get(f, `/orders/${Math.floor(rand() * 1e6)}`);
    return [o.status, o.courier.name, o.courier.phone /* "Call rider" button */, o.items.map((i: any) => `${i.qty}× ${i.name} ${i.price}`), o.total];
  },
  home: async (f) => (await get(f, "/restaurants")).map((r: any) => `${r.name} ★${r.rating.toFixed(1)}`), // crashes if rating is null
  profile: async (f) => { const me = await get(f, "/me"); return [me.name, me.email, me.loyalty.points]; },
};
const v45: Screens = { ...v4, profile: async (f) => { const me = await get(f, "/me"); return [me.name, me.avatarUrl, me.loyalty.tier]; } };
const v5: Screens = {
  orderTracking: async (f) => {
    const o = await get(f, `/orders/${Math.floor(rand() * 1e6)}`);
    // 5.0 shipped masked calling (no raw phone) and a live ETA + map
    return [o.status, `${o.eta} min`, o.courier.name, o.courier.vehicle, o.courier.location.lat, o.courier.location.lng, o.items.length, o.total];
  },
  home: async (f) => (await get(f, "/restaurants")).map((r: any) => [r.name, r.cuisine, r.deliveryFee]),
  profile: async (f) => { const me = await get(f, "/me"); return [me.name, me.avatarUrl]; },
};

// simulated fleet: installs per version (scaled down 10x for speed; shares are what matter)
const fleet: { platform: string; version: string; installs: number; screens: Screens }[] = [
  { platform: "android", version: "4.4.0", installs: 90, screens: v4 },
  { platform: "android", version: "4.5.2", installs: 150, screens: v45 },
  { platform: "android", version: "5.0.0", installs: 410, screens: v5 },
  { platform: "ios", version: "4.2.0", installs: 30, screens: v4 },
  { platform: "ios", version: "4.3.1", installs: 70, screens: v4 },
  { platform: "ios", version: "4.5.0", installs: 120, screens: v45 },
  { platform: "ios", version: "5.0.0", installs: 400, screens: v5 },
  { platform: "web", version: "2026.11.2", installs: 60, screens: { home: v5.home!, orderTracking: v5.orderTracking! } },
];
const openChance: Record<string, number> = { orderTracking: 0.75, home: 0.95, profile: 0.35 };

async function main() {
  const store = new Store(":memory:");
  const server = createCollector({ store }).listen(0);
  await new Promise((r) => server.once("listening", r));
  const endpoint = `http://127.0.0.1:${(server.address() as any).port}`;
  let reports = 0;
  for (const v of fleet) {
    for (let i = 0; i < v.installs; i++) {
      const client = await createClient({
        endpoint, app: { platform: v.platform, version: v.version }, fetchImpl: api,
        filter: (u) => u.startsWith(API), setIntervalImpl: () => 0, clearIntervalImpl: () => {},
        send: async (url, body, headers) => { reports++; return (await fetch(url, { method: "POST", body, headers })).ok; },
      });
      for (const [name, screen] of Object.entries(v.screens)) if (rand() < (openChance[name] ?? 0.5)) await screen(client.fetch);
      await client.flush();
      client.stop();
    }
  }
  const snap = store.snapshot(30);
  server.close();

  const oldSpec = JSON.parse(readFileSync("examples/eats/openapi-main.json", "utf8"));
  const newSpec = JSON.parse(readFileSync("examples/eats/openapi-pr-482.json", "utf8"));
  const report = assess(diffSpecs(flattenSpec(oldSpec), flattenSpec(newSpec)), snap);
  const md = toMarkdown(report, sortVersions(snap.versions));
  const unused = unusedFields(flattenSpec(oldSpec), snap);

  mkdirSync("examples/eats/out", { recursive: true });
  writeFileSync("examples/eats/out/snapshot.json", JSON.stringify(snap, null, 2));
  writeFileSync("examples/eats/out/pr-482-report.md", md);
  writeFileSync("examples/eats/out/dashboard-data.json", JSON.stringify({
    snapshot: snap, report, unused,
    spec: Object.fromEntries([...flattenSpec(oldSpec)].map(([r, f]) => [r, Object.fromEntries(f)])),
    specTitle: "Eats API", prTitle: "PR #482: API cleanup",
  }));
  console.log(`${reports} reports from ${fleet.reduce((s, v) => s + v.installs, 0)} simulated installs\n`);
  console.log(md);
  console.log("\nUnused today:", unused.map((u) => `${u.route} ${u.path}`).join(", "));
}
main();
