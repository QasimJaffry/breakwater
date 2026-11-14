import type { SpecFields, FieldInfo } from "./openapi";

export type ChangeKind = "route_removed" | "field_removed" | "type_changed" | "now_nullable" | "now_optional";
export interface Change { kind: ChangeKind; route: string; path: string; detail: string }

const isChildOf = (child: string, parent: string) =>
  parent === "" ? child !== "" : child.startsWith(parent + ".") || child.startsWith(parent + "[]");

/** Response-side changes that can break a client that reads the field. Additions are never breaking. */
export function diffSpecs(oldSpec: SpecFields, newSpec: SpecFields): Change[] {
  const changes: Change[] = [];
  for (const [route, oldFields] of oldSpec) {
    const newFields = newSpec.get(route);
    if (!newFields) { changes.push({ kind: "route_removed", route, path: "", detail: "endpoint removed" }); continue; }
    const removed = [...oldFields.keys()].filter((p) => p !== "" && !newFields.has(p));
    // report only the top-most removed path; its children are implied
    for (const p of removed) if (!removed.some((q) => q !== p && isChildOf(p, q))) {
      changes.push({ kind: "field_removed", route, path: p, detail: "field removed" });
    }
    for (const [p, o] of oldFields) {
      const n = newFields.get(p) as FieldInfo | undefined;
      if (!n) continue;
      const added = n.types.filter((t) => !o.types.includes(t) && !(t === "number" && o.types.includes("integer")));
      if (added.length && o.types.length) changes.push({ kind: "type_changed", route, path: p, detail: `${o.types.join("|")} → ${n.types.join("|")}` });
      if (!o.nullable && n.nullable) changes.push({ kind: "now_nullable", route, path: p, detail: "can now be null" });
      if (o.required && !n.required) changes.push({ kind: "now_optional", route, path: p, detail: "no longer required (may be missing)" });
    }
  }
  return changes;
}

export { isChildOf };
