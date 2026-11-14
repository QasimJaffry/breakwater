import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Store, validateReport, ReportError } from "./store";

const MAX_BODY = 256 * 1024;

export function createCollector(opts: { store: Store; ingestKey?: string; readKey?: string; allowOrigin?: string }) {
  const { store } = opts;
  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, {
      "content-type": "application/json",
      ...(status === 413 ? { connection: "close" } : {}),
      "access-control-allow-origin": opts.allowOrigin ?? "*",
      "access-control-allow-headers": "content-type, x-breakwater-key",
    });
    res.end(JSON.stringify(body));
  };
  const readBody = (req: IncomingMessage) =>
    new Promise<string>((resolve, reject) => {
      if (Number(req.headers["content-length"] ?? 0) > MAX_BODY) { req.resume(); reject(new ReportError("body too large")); return; }
      let n = 0, over = false; const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => {
        if (over) return; // discard the rest; we already answered 413
        n += c.length;
        if (n > MAX_BODY) { over = true; chunks.length = 0; reject(new ReportError("body too large")); return; }
        chunks.push(c);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://x");
      if (req.method === "OPTIONS") return send(res, 204, null);
      if (req.method === "POST" && url.pathname === "/v1/reports") {
        if (opts.ingestKey && req.headers["x-breakwater-key"] !== opts.ingestKey) return send(res, 401, { error: "unauthorized" });
        let parsed: unknown;
        try { parsed = JSON.parse(await readBody(req)); } catch (e) {
          return send(res, e instanceof ReportError ? 413 : 400, { error: e instanceof ReportError ? e.message : "invalid JSON" });
        }
        store.ingest(validateReport(parsed));
        return send(res, 202, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/v1/snapshot") {
        if (opts.readKey && req.headers["x-breakwater-key"] !== opts.readKey) return send(res, 401, { error: "unauthorized" });
        const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days") ?? 30) || 30));
        return send(res, 200, store.snapshot(days));
      }
      return send(res, 404, { error: "not found" });
    } catch (e) {
      if (e instanceof ReportError) return send(res, 400, { error: e.message });
      console.error(JSON.stringify({ scope: "breakwater", event: "error", error: e instanceof Error ? e.name : "unknown" }));
      return send(res, 500, { error: "internal" });
    }
  });
}
