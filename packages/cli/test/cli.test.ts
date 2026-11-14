import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flattenSpec, diffSpecs, assess, unusedFields, toMarkdown, sortVersions, routeShape, main } from "@breakwater/cli";
import { specV1, specV2, snapshot } from "./fixtures";

describe("flattenSpec", () => {
  const f = flattenSpec(specV1);
  it("resolves $refs and uses SDK path syntax", () => {
    const order = f.get("GET /orders/:*")!;
    expect([...order.keys()].sort()).toEqual(["", "courier", "courier.name", "courier.phone", "courier.vehicle", "eta", "id", "items", "items[]", "items[].name", "items[].price", "legacyTip", "status"]);
    expect(order.get("courier.vehicle")).toEqual({ types: ["string"], nullable: false, required: false });
  });
  it("root arrays and recursive schemas terminate", () => {
    const r = f.get("GET /restaurants")!;
    expect(r.has("[]") && r.has("[].parent") && r.has("[].name")).toBe(true);
    expect([...r.keys()].every((k) => k.length < 40)).toBe(true);
  });
  it("route shapes join {param} and :param", () => {
    expect(routeShape("GET /orders/{orderId}")).toBe(routeShape("GET /orders/:id"));
  });
  it("handles 3.0 nullable, allOf and oneOf", () => {
    const doc = { paths: { "/x": { get: { responses: { "200": { content: { "application/json": { schema: {
      allOf: [{ type: "object", required: ["a"], properties: { a: { type: "string", nullable: true } } }],
      oneOf: [{ type: "object", required: ["b"], properties: { b: { type: "integer" } } }, { type: "object", properties: { c: { type: "string" } } }],
    } } } } } } } } };
    const x = flattenSpec(doc).get("GET /x")!;
    expect(x.get("a")).toEqual({ types: ["string"], nullable: true, required: true });
    expect(x.get("b")?.required).toBe(false); // only one variant has it
    expect(x.has("c")).toBe(true);
  });
});

describe("diffSpecs", () => {
  it("finds every breaking response change and nothing else", () => {
    const changes = diffSpecs(flattenSpec(specV1), flattenSpec(specV2)).map((c) => `${c.kind} ${c.route} ${c.path}`).sort();
    expect(changes).toEqual([
      "field_removed GET /orders/:* courier.phone",
      "field_removed GET /orders/:* legacyTip",
      "now_nullable GET /restaurants [].rating",
      "route_removed GET /promos/legacy ",
      "type_changed GET /orders/:* eta",
    ]);
  });
  it("adding fields and endpoints is not breaking", () => {
    const v3 = JSON.parse(JSON.stringify(specV1));
    v3.components.schemas.Courier.properties.photo = { type: "string" };
    v3.paths["/new"] = { get: { responses: { "200": { content: { "application/json": { schema: { type: "object" } } } } } } };
    expect(diffSpecs(flattenSpec(specV1), flattenSpec(v3))).toEqual([]);
  });
  it("reports only the top-most removed path", () => {
    const v3 = JSON.parse(JSON.stringify(specV1));
    delete v3.components.schemas.Order.properties.courier;
    v3.components.schemas.Order.required = ["id"];
    const removed = diffSpecs(flattenSpec(specV1), flattenSpec(v3)).filter((c) => c.kind === "field_removed").map((c) => c.path);
    expect(removed).toEqual(["courier"]);
  });
});

describe("assess", () => {
  const report = assess(diffSpecs(flattenSpec(specV1), flattenSpec(specV2)), snapshot);
  it("weights each change by the installs of versions that read it", () => {
    const by = Object.fromEntries(report.breaking.map((b) => [`${b.kind} ${b.path}`, b]));
    expect(by["field_removed courier.phone"]!.installs).toBe(900 + 300 + 700);
    expect(by["type_changed eta"]!.installs).toBe(4100 + 4000);
    expect(by["now_nullable [].rating"]).toBeUndefined(); // ios 5.0 reads names, never rating
    expect(report.totalInstalls).toBe(10000);
  });
  it("unread changes are harmless, and the union is not double counted", () => {
    expect(report.harmless.map((h) => `${h.kind} ${h.path}`).sort()).toEqual(["field_removed legacyTip", "now_nullable [].rating", "route_removed "]);
    expect(report.affectedInstalls).toBe(10000); // phone (old versions) + eta (5.0) covers everyone
    expect(report.affectedShare).toBe(1);
  });
  it("reading a parent object in bulk counts as reading the removed child", () => {
    const snap = structuredClone(snapshot);
    snap.usage["GET /orders/:id"] = { "courier.phone.country": ["ios@4.2.0"] } as any;
    const r = assess(diffSpecs(flattenSpec(specV1), flattenSpec(specV2)), snap);
    expect(r.breaking.find((b) => b.path === "courier.phone")?.installs).toBe(300);
  });
});

describe("report + unused", () => {
  const report = assess(diffSpecs(flattenSpec(specV1), flattenSpec(specV2)), snapshot);
  it("markdown names versions as ranges and shows the share", () => {
    const md = toMarkdown(report, sortVersions(snapshot.versions));
    expect(md).toContain("reach **100% of active installs** (10,000 of 10,000)");
    expect(md).toContain("android 4.4.0; ios 4.2.0–4.3.1 | 1,900 (19%)");
    expect(md).toContain("Type changed (integer → string)");
  });
  it("unused lists top-most fields nobody reads", () => {
    const rows = unusedFields(flattenSpec(specV1), snapshot).map((r) => `${r.route} ${r.path}`);
    expect(rows).toContain("GET /orders/:* legacyTip");
    expect(rows).toContain("GET /orders/:* courier.vehicle");
    expect(rows).toContain("GET /restaurants [].rating");
    expect(rows).not.toContain("GET /orders/:* courier.phone");
    expect(rows).not.toContain("GET /orders/:* items[].name".replace("name", "price"));
  });
});

describe("CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "bw-"));
  const w = (n: string, d: unknown) => { const p = join(dir, n); writeFileSync(p, JSON.stringify(d)); return p; };
  const old = w("v1.json", specV1), neu = w("v2.json", specV2), snap = w("snap.json", snapshot);
  it("exit 1 when breaking share is above the threshold, 0 below", async () => {
    const log = console.log; console.log = () => {};
    try {
      expect(await main(["check", "--old", old, "--new", neu, "--snapshot", snap])).toBe(1);
      expect(await main(["check", "--old", old, "--new", neu, "--snapshot", snap, "--fail-above", "1"])).toBe(0);
      expect(await main(["check", "--old", old, "--new", old, "--snapshot", snap])).toBe(0);
      expect(await main(["check", "--old", old])).toBe(2);
    } finally { console.log = log; }
  });
});
