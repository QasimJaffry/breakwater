import { describe, expect, it } from "vitest";
import { Store, validateReport, createCollector } from "@breakwater/collector";

const rep = (version: string, installId: string, routes: Record<string, string[]>, platform = "ios") =>
  ({ schema: 1 as const, app: { version, platform }, installId, routes });
const id = (n: number) => n.toString(16).padStart(32, "0");

describe("validateReport", () => {
  it("accepts a well-formed report", () => {
    expect(validateReport(rep("4.2.0", id(1), { "GET /orders/:id": ["courier.phone", "items[].price"] }))).toBeTruthy();
  });
  it.each([
    ["non-object", 5],
    ["wrong schema", { ...rep("1", id(1), {}), schema: 2 }],
    ["bad install id", rep("1", "nope", {})],
    ["script in path", rep("1", id(1), { "GET /x": ["<script>"] })],
    ["routes array", { ...rep("1", id(1), {}), routes: [] }],
    ["huge path", rep("1", id(1), { "GET /x": ["a".repeat(400)] })],
  ])("rejects %s", (_n, body) => expect(() => validateReport(body)).toThrow());
});

describe("Store", () => {
  it("aggregates usage per version and counts installs, honouring the window", () => {
    let now = new Date("2026-11-01T00:00:00Z");
    const s = new Store(":memory:", () => now);
    s.ingest(validateReport(rep("4.1.0", id(1), { "GET /orders/:id": ["courier.phone"] })));
    s.ingest(validateReport(rep("4.2.0", id(2), { "GET /orders/:id": ["courier.phone", "eta"] })));
    s.ingest(validateReport(rep("4.2.0", id(3), { "GET /orders/:id": ["eta"] })));
    s.ingest(validateReport(rep("5.0.0", id(4), { "GET /orders/:id": ["eta"] }, "android")));
    now = new Date("2026-11-20T00:00:00Z");
    const snap = s.snapshot(30);
    expect(snap.versions).toEqual([
      { platform: "android", version: "5.0.0", installs: 1 },
      { platform: "ios", version: "4.1.0", installs: 1 },
      { platform: "ios", version: "4.2.0", installs: 2 },
    ]);
    expect(snap.usage["GET /orders/:id"]).toEqual({
      "courier.phone": ["ios@4.1.0", "ios@4.2.0"],
      eta: ["android@5.0.0", "ios@4.2.0"],
    });
    expect(s.snapshot(7).versions).toEqual([]); // all older than 7 days
  });

  it("an install that upgrades moves to its new version", () => {
    const s = new Store();
    s.ingest(validateReport(rep("4.1.0", id(9), { "GET /a": ["x"] })));
    s.ingest(validateReport(rep("4.2.0", id(9), { "GET /a": ["x"] })));
    expect(s.snapshot().versions).toEqual([{ platform: "ios", version: "4.2.0", installs: 1 }]);
  });
});

describe("HTTP collector", () => {
  it("ingests, rejects bad input, enforces keys and size", async () => {
    const server = createCollector({ store: new Store(), ingestKey: "in", readKey: "rd" }).listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const post = (body: string, key = "in") => fetch(`${base}/v1/reports`, { method: "POST", body, headers: { "x-breakwater-key": key } });
    try {
      expect((await post(JSON.stringify(rep("1.0.0", id(1), { "GET /a": ["b"] })))).status).toBe(202);
      expect((await post("{", "in")).status).toBe(400);
      expect((await post(JSON.stringify({ schema: 1 }))).status).toBe(400);
      expect((await post("{}", "wrong")).status).toBe(401);
      expect((await post("x".repeat(300 * 1024))).status).toBe(413);
      expect((await fetch(`${base}/v1/snapshot`)).status).toBe(401);
      const snap = await (await fetch(`${base}/v1/snapshot`, { headers: { "x-breakwater-key": "rd" } })).json();
      expect(snap.usage).toEqual({ "GET /a": { b: ["ios@1.0.0"] } });
    } finally {
      server.close();
    }
  });
});
