import { describe, expect, it, vi } from "vitest";
import { Recorder, wrapFetch, newInstallId } from "@breakwater/core";

const app = { version: "4.2.0", platform: "ios" };

describe("Recorder", () => {
  it("aggregates paths per route and only reports new information", () => {
    const r = new Recorder({ app, installId: "i1" });
    const a = r.observe("GET", "/orders/1", { id: 1, total: 5 });
    void a.total;
    const b = r.observe("GET", "/orders/2", { id: 2, total: 9 });
    void b.total; void b.id;
    const rep = r.drain(new Date("2026-11-14T00:00:00Z"))!;
    expect(rep).toEqual({
      schema: 1, app, installId: "i1", sentAt: "2026-11-14T00:00:00.000Z",
      routes: { "GET /orders/:id": ["id", "total"] },
    });
    expect(r.drain()).toBeNull(); // nothing new
    void r.observe("GET", "/orders/3", { id: 3, total: 1 }).total;
    expect(r.drain()).toBeNull(); // still nothing new
  });

  it("report never contains values", () => {
    const r = new Recorder({ app, installId: "i1" });
    const secret = r.observe("GET", "/me", { email: "q@example.com", card: { last4: "4242" } });
    void secret.email; void secret.card.last4;
    const txt = JSON.stringify(r.drain());
    expect(txt).not.toContain("example.com");
    expect(txt).not.toContain("4242");
  });

  it("sampling skips tracking entirely", () => {
    const r = new Recorder({ app, installId: "i", sampleRate: 0.5, random: () => 0.9 });
    const v = { a: 1 };
    expect(r.observe("GET", "/x", v)).toBe(v);
  });

  it("retry re-sends after a failed transport", () => {
    const r = new Recorder({ app, installId: "i" });
    void r.observe("GET", "/x", { a: 1 }).a;
    expect(r.drain()).not.toBeNull();
    r.retry();
    expect(r.drain()?.routes).toEqual({ "GET /x": ["a"] });
  });

  it("maxDepth bounds path length", () => {
    const r = new Recorder({ app, installId: "i", maxDepth: 2 });
    const v = r.observe("GET", "/x", { a: { b: { c: { d: 1 } } } });
    void v.a.b.c.d;
    expect(r.drain()?.routes["GET /x"]).toEqual(["a", "a.b", "a.b.c"]);
  });

  it("install ids are 32 hex chars", () => {
    expect(newInstallId()).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("wrapFetch", () => {
  it("tracks response.json() with method and url", async () => {
    const r = new Recorder({ app, installId: "i" });
    const base = vi.fn(async () => new Response(JSON.stringify({ id: 1, name: "x" })));
    const f = wrapFetch(base as typeof fetch, r);
    const res = await f("https://api.example.com/users/42", { method: "GET" });
    const j = await res.json();
    expect(j.name).toBe("x");
    expect(r.drain()?.routes).toEqual({ "GET /users/:id": ["name"] });
  });

  it("respects the filter (e.g. only your own API)", async () => {
    const r = new Recorder({ app, installId: "i" });
    const f = wrapFetch((async () => new Response("{\"a\":1}")) as typeof fetch, r, (u) => u.startsWith("https://api.mine"));
    void (await (await f("https://cdn.other.com/x")).json()).a;
    expect(r.drain()).toBeNull();
  });

  it("works with Request objects", async () => {
    const r = new Recorder({ app, installId: "i" });
    const f = wrapFetch((async () => new Response("{\"ok\":true}")) as typeof fetch, r);
    void (await (await f(new Request("https://api.x/y/7", { method: "POST" }))).json()).ok;
    expect(r.drain()?.routes).toEqual({ "POST /y/:id": ["ok"] });
  });
});
