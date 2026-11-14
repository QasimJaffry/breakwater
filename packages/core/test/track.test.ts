import { describe, expect, it } from "vitest";
import { track, unwrap } from "@breakwater/core";

const body = () => ({
  id: 7,
  status: "delivered",
  courier: { name: "Ali", phone: "+92-300", rating: 4.8 },
  items: [
    { sku: "a", price: 100, tags: ["x"] },
    { sku: "b", price: 250, tags: [] },
  ],
  meta: null,
  empty: {},
});

function run<T>(fn: (b: ReturnType<typeof body>) => T) {
  const reads = new Set<string>();
  const t = track(body(), (p) => reads.add(p));
  const out = fn(t);
  return { reads: [...reads].sort(), out };
}

describe("track: which paths count as read", () => {
  it("property reads, nested", () => {
    const { reads, out } = run((b) => b.courier.phone);
    expect(out).toBe("+92-300");
    expect(reads).toEqual(["courier", "courier.phone"]);
  });

  it("array elements collapse to []", () => {
    const { reads, out } = run((b) => b.items.map((i) => i.price).reduce((a, c) => a + c, 0));
    expect(out).toBe(350);
    expect(reads).toEqual(["items", "items[]", "items[].price"]);
  });

  it("length and array methods are not fields", () => {
    const { reads } = run((b) => b.items.length);
    expect(reads).toEqual(["items"]);
  });

  it("`in` counts as a read of that field", () => {
    const { reads, out } = run((b) => "rating" in b.courier);
    expect(out).toBe(true);
    expect(reads).toContain("courier.rating");
  });

  it("missing fields, prototype members and await's `then` probe are not recorded", async () => {
    const reads = new Set<string>();
    const t: any = track(body(), (p) => reads.add(p));
    void t.nickname; void t.toString; void t.constructor; void t.hasOwnProperty;
    const awaited = await Promise.resolve(t); // resolves via `then` lookup
    expect(awaited.id).toBe(7);
    expect([...reads]).toEqual(["id"]);
  });

  it("bulk reads (spread, JSON.stringify, Object.entries) mark everything they touch", () => {
    const a = run((b) => ({ ...b.courier }));
    expect(a.reads).toEqual(["courier", "courier.name", "courier.phone", "courier.rating"]);
    const s = run((b) => JSON.stringify(b.items));
    expect(s.out).toBe(JSON.stringify(body().items));
    expect(s.reads).toEqual(["items", "items[]", "items[].price", "items[].sku", "items[].tags", "items[].tags[]"]);
    const e = run((b) => Object.entries(b.courier).length);
    expect(e.reads).toEqual(["courier", "courier.name", "courier.phone", "courier.rating"]);
  });

  it("destructuring", () => {
    const { reads } = run(({ status, courier: { name } }) => status + name);
    expect(reads).toEqual(["courier", "courier.name", "status"]);
  });

  it("for..of and for..in", () => {
    const { reads } = run((b) => {
      let n = 0;
      for (const it of b.items) n += it.sku.length;
      for (const k in b.courier) n += k.length;
      return n;
    });
    expect(reads).toEqual(["courier", "items", "items[]", "items[].sku"]);
  });

  it("root arrays", () => {
    const reads = new Set<string>();
    const t = track([{ a: 1 }, { a: 2, b: 3 }], (p) => reads.add(p));
    expect(t.filter((x) => x.a > 1).length).toBe(1);
    expect([...reads].sort()).toEqual(["[]", "[].a"]);
  });

  it("null, primitives and empty objects", () => {
    const { reads, out } = run((b) => [b.meta, Object.keys(b.empty).length]);
    expect(out).toEqual([null, 0]);
    expect(reads).toEqual(["empty", "meta"]);
    expect(track(5, () => { throw new Error("no"); })).toBe(5);
    expect(track(null, () => {})).toBe(null);
  });
});

describe("track: behaves like the raw value", () => {
  it("Array.isArray, typeof, equality of deep values", () => {
    const t = track(body(), () => {});
    expect(Array.isArray(t.items)).toBe(true);
    expect(t).toEqual(body());
    expect(JSON.parse(JSON.stringify(t))).toEqual(body());
  });

  it("stable identity for repeated reads (React memo/deps safe)", () => {
    const t = track(body(), () => {});
    expect(t.courier).toBe(t.courier);
    expect(t.items[0]).toBe(t.items[0]);
  });

  it("mutation still works and is not reported", () => {
    const reads: string[] = [];
    const t: any = track(body(), (p) => reads.push(p));
    t.status = "x";
    t.items.push({ sku: "c" });
    expect(unwrap(t).status).toBe("x");
    expect(unwrap(t).items).toHaveLength(3);
    expect(reads).toEqual(["items"]);
  });

  it("unwrap gives the raw object, which structuredClone accepts", () => {
    const t = track(body(), () => {});
    expect(() => structuredClone(t)).toThrow();
    expect(structuredClone(unwrap(t))).toEqual(body());
    expect(unwrap(t.courier)).toEqual(body().courier);
    expect(unwrap(3)).toBe(3);
  });
});
