/**
 * Flatten the success-response schemas of an OpenAPI 3.0/3.1 document into field paths that use the
 * SDK's path syntax: `courier.phone`, `items[]`, `items[].price`, `[]` for a root array.
 */
export interface FieldInfo { types: string[]; nullable: boolean; required: boolean }
export type RouteFields = Map<string, FieldInfo>; // path -> info ("" is the root)
export type SpecFields = Map<string, RouteFields>; // "GET /orders/:*" -> fields

type Json = any;
const METHODS = ["get", "post", "put", "patch", "delete"];

/** `/orders/{orderId}` and `/orders/:id` both become `/orders/:*` so spec and usage routes join. */
export const routeShape = (route: string) => route.replace(/\{[^}]+\}|:[A-Za-z_][\w]*/g, ":*");

/** Follow $refs. Returns the schema and the set of refs on the current branch (for cycle detection). */
function deref(doc: Json, s: Json, seen: Set<string>): [Json, Set<string>] {
  while (s && typeof s === "object" && typeof s.$ref === "string") {
    if (seen.has(s.$ref)) return [{ "x-breakwater-cycle": true }, seen]; // recursive schema: stop here
    seen = new Set(seen).add(s.$ref);
    const parts = s.$ref.replace(/^#\//, "").split("/").map((p: string) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
    s = parts.reduce((o: Json, k: string) => o?.[k], doc);
    if (s === undefined) throw new Error(`unresolvable $ref`);
  }
  return [s ?? {}, seen];
}
const resolve = (doc: Json, s: Json, seen: Set<string>): Json => deref(doc, s, seen)[0];

function typesOf(s: Json): { types: string[]; nullable: boolean } {
  let t: string[] = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
  let nullable = s.nullable === true || t.includes("null");
  t = t.filter((x) => x !== "null");
  if (!t.length && s.properties) t = ["object"];
  if (!t.length && s.items) t = ["array"];
  if (s.enum?.includes?.(null)) nullable = true;
  return { types: [...new Set(t)].sort(), nullable };
}

function walk(doc: Json, raw: Json, path: string, required: boolean, out: RouteFields, seen: Set<string>, depth: number) {
  if (depth > 25) return;
  const [s, here] = deref(doc, raw, seen);
  seen = here;
  const variants: Json[] = [];
  const alternatives = new Set<Json>(); // oneOf/anyOf members: their fields are possible, never guaranteed
  // allOf merges; oneOf/anyOf: any variant may be returned, so every variant's fields are possible
  for (const k of ["allOf", "oneOf", "anyOf"]) {
    if (!Array.isArray(s[k])) continue;
    for (const v of s[k]) {
      const r = resolve(doc, v, seen);
      variants.push(r);
      if (k !== "allOf") alternatives.add(r);
    }
  }
  const own = typesOf(s);
  const varTypes = variants.map(typesOf);
  const info: FieldInfo = {
    types: [...new Set([...own.types, ...varTypes.flatMap((v) => v.types)])].sort(),
    nullable: own.nullable || varTypes.some((v) => v.nullable),
    required,
  };
  const prev = out.get(path);
  out.set(path, prev ? { types: [...new Set([...prev.types, ...info.types])].sort(), nullable: prev.nullable || info.nullable, required: prev.required && info.required } : info);

  for (const part of [s, ...variants]) {
    const req = new Set<string>(Array.isArray(part.required) ? part.required : []);
    for (const [k, sub] of Object.entries<Json>(part.properties ?? {})) {
      // a field only some oneOf variants have is not guaranteed present
      walk(doc, sub, path ? `${path}.${k}` : k, req.has(k) && !alternatives.has(part), out, seen, depth + 1);
    }
    if (part.items) walk(doc, part.items, `${path}[]`, true, out, seen, depth + 1);
  }
}

export function flattenSpec(doc: Json): SpecFields {
  const out: SpecFields = new Map();
  for (const [p, item] of Object.entries<Json>(doc.paths ?? {})) {
    for (const m of METHODS) {
      const op = item?.[m];
      if (!op) continue;
      const responses = op.responses ?? {};
      const code = ["200", "201", "202", "2XX", "2xx", "default"].find((c) => responses[c]);
      const resp = code ? resolve(doc, responses[code], new Set()) : undefined;
      const content = resp?.content ?? {};
      const media = Object.keys(content).find((k) => /json/i.test(k));
      const fields: RouteFields = new Map();
      if (media && content[media].schema) walk(doc, content[media].schema, "", true, fields, new Set(), 0);
      out.set(routeShape(`${m.toUpperCase()} ${p}`), fields);
    }
  }
  return out;
}
