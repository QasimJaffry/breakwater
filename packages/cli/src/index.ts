export { flattenSpec, routeShape, type SpecFields, type FieldInfo } from "./openapi";
export { diffSpecs, type Change, type ChangeKind } from "./diff";
export { assess, unusedFields, sortVersions, usageByShape, type Impact, type ImpactReport, type VersionRef } from "./impact";
export { toMarkdown, versionRanges } from "./report";
export { main } from "./cli";
