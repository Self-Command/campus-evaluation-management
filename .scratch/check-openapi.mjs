// Parses the OpenAPI draft to catch YAML or reference mistakes without a server.
// Usage: node .scratch/check-openapi.mjs
import fs from "node:fs";
import yaml from "js-yaml";

const text = fs.readFileSync("docs/api/openapi.current.yaml", "utf8");
const doc = yaml.load(text);
const paths = Object.keys(doc.paths ?? {});
let problems = 0;
const refs = [...text.matchAll(/\$ref: '#\/components\/([a-zA-Z]+)\/([A-Za-z0-9_.-]+)'/g)];
for (const [, group, name] of refs) {
  if (!doc.components?.[group]?.[name]) { console.log(`MISSING REF $ref: #/components/${group}/${name}`); problems++; }
}
for (const [path, item] of Object.entries(doc.paths ?? {})) {
  for (const [method, operation] of Object.entries(item)) {
    if (["parameters", "summary", "description", "servers"].includes(method)) continue;
    if (!operation || typeof operation !== "object") continue;
    if (!operation.operationId) { console.log(`MISSING operationId ${method.toUpperCase()} ${path}`); problems++; }
  }
}
console.log(`${paths.length} paths, ${refs.length} refs, ${problems ? `${problems} problem(s)` : "no structural problems"}`);
