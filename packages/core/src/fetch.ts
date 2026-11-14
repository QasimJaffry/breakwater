import type { Recorder } from "./recorder";

type FetchLike = (input: any, init?: any) => Promise<Response>;

/**
 * Wrap a fetch implementation so `response.json()` returns a tracked value.
 * Works with the browser, Node 18+ and React Native fetch (all expose Response.prototype.json).
 */
export function wrapFetch<F extends FetchLike>(fetchImpl: F, recorder: Recorder, filter?: (url: string) => boolean): F {
  const wrapped = async (input: any, init?: any) => {
    const res = await fetchImpl(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : String(input?.url ?? "");
    if (filter && !filter(url)) return res;
    const method = String(init?.method ?? (typeof input === "object" && input && "method" in input ? input.method : "GET"));
    const json = res.json.bind(res);
    Object.defineProperty(res, "json", {
      configurable: true,
      value: async () => recorder.observe(method, url, await json()),
    });
    return res;
  };
  return wrapped as unknown as F;
}
