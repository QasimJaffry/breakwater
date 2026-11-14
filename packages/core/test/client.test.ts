import { describe, expect, it, vi } from "vitest";
import { createClient } from "@breakwater/core";

const api = vi.fn(async (u: string) => new Response(JSON.stringify({ id: 1, name: "x", secret: "s3cr3t" })));

async function setup(sendOk = true) {
  const sent: any[] = [];
  let bg: (() => void) | undefined;
  const store = new Map<string, string>();
  const c = await createClient({
    endpoint: "https://bw.test",
    app: { version: "1.2.3", platform: "android" },
    fetchImpl: api as any,
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
    onBackground: (f) => { bg = f; return () => { bg = undefined; }; },
    send: async (url, body) => { sent.push({ url, body: JSON.parse(body) }); return sendOk; },
    setIntervalImpl: () => 0, clearIntervalImpl: () => {},
  });
  return { c, sent, bg: () => bg?.(), store };
}

describe("createClient", () => {
  it("tracks fetch, flushes on background, never sends values", async () => {
    const { c, sent, bg } = await setup();
    const j = await (await c.fetch("https://api.test/users/9")).json();
    void j.name;
    bg();
    await c.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("https://bw.test/v1/reports");
    expect(sent[0].body.routes).toEqual({ "GET /users/:id": ["name"] });
    expect(JSON.stringify(sent[0].body)).not.toContain("s3cr3t");
  });

  it("persists one install id across launches", async () => {
    const a = await setup();
    const id = a.store.get("breakwater.installId");
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("keeps data for the next flush when sending fails", async () => {
    const { c, sent } = await setup(false);
    void (await (await c.fetch("https://api.test/a")).json()).id;
    await c.flush();
    await c.flush();
    expect(sent).toHaveLength(2);
    expect(sent[1].body.routes).toEqual({ "GET /a": ["id"] });
  });

  it("does not track its own collector traffic", async () => {
    const { c, sent } = await setup();
    void (await (await c.fetch("https://bw.test/v1/snapshot")).json()).id;
    await c.flush();
    expect(sent).toHaveLength(0);
  });

  it("stop unsubscribes the background hook", async () => {
    const s = await setup();
    s.c.stop();
    void (await (await s.c.fetch("https://api.test/a")).json()).id;
    s.bg();
    await Promise.resolve();
    expect(s.sent).toHaveLength(0);
  });
});
