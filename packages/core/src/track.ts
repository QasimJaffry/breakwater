/**
 * Read tracking for parsed JSON.
 *
 * `track(value, onRead)` returns a stand-in that behaves like `value` for normal code (property reads,
 * `in`, iteration, array methods, spread, JSON.stringify, Array.isArray) and reports the *path* of every
 * own property that is read, e.g. `items[].price`. Values are never reported, only paths.
 *
 * Known semantic differences (documented in the README): `structuredClone` / `postMessage` of a tracked
 * value throw (Proxies are not cloneable; call `unwrap` first), and a tracked object is not `===` the raw
 * parsed object (it is stable across reads of the same path).
 */

const RAW = Symbol.for("breakwater.raw");
export type OnRead = (path: string) => void;

const isContainer = (v: unknown): v is object => typeof v === "object" && v !== null;
const isIndex = (k: string) => k !== "" && String(Number(k) >>> 0) === k && k !== "4294967295";

export const childPath = (parent: string, key: string, parentIsArray: boolean): string =>
  parentIsArray ? `${parent}[]` : parent ? `${parent}.${key}` : key;

export function track<T>(value: T, onRead: OnRead): T {
  if (!isContainer(value)) return value;
  const cache = new WeakMap<object, object>();

  const wrap = (target: object, path: string): object => {
    const hit = cache.get(target);
    if (hit) return hit;
    const isArr = Array.isArray(target);
    const proxy = new Proxy(target, {
      get(t, key, receiver) {
        if (key === RAW) return t;
        const v = Reflect.get(t, key, receiver);
        // Symbols, prototype methods (map, toJSON, then, constructor...) and array length are not fields.
        if (typeof key !== "string" || !Object.prototype.hasOwnProperty.call(t, key)) return v;
        if (isArr && !isIndex(key)) return v;
        const p = childPath(path, key, isArr);
        onRead(p);
        return isContainer(v) ? wrap(v, p) : v;
      },
      has(t, key) {
        const present = Reflect.has(t, key);
        if (typeof key === "string" && present && Object.prototype.hasOwnProperty.call(t, key) && (!isArr || isIndex(key))) {
          onRead(childPath(path, key, isArr));
        }
        return present;
      },
    });
    cache.set(target, proxy);
    return proxy;
  };

  return wrap(value, "") as T;
}

/** The raw parsed value behind a tracked one (or the value itself). Use before structuredClone/postMessage. */
export function unwrap<T>(value: T): T {
  return isContainer(value) ? (((value as Record<symbol, unknown>)[RAW] as T) ?? value) : value;
}
