import { readFile } from "node:fs/promises";

const targets = [
  ["northflank/template.json", "https://api.northflank.com/v1/schemas/template"],
  ["northflank/release-flow.json", "https://api.northflank.com/v1/schemas/release-flow"],
];

for (const [file, schemaUrl] of targets) {
  const [document, response] = await Promise.all([readFile(file, "utf8").then(JSON.parse), fetch(schemaUrl)]);
  if (!response.ok) throw new Error(`Unable to download schema for ${file}: ${response.status}`);
  const schema = await response.json();
  const errors = [];
  if (document.apiVersion !== "v1.2") errors.push("/apiVersion must be v1.2");
  if (!document.spec || typeof document.spec !== "object") errors.push("/spec is required");
  else validateValue(document.spec, schema.properties.spec, schema, "/spec", errors);
  if (errors.length) {
    console.error(`${file} is invalid against ${schemaUrl}:`);
    errors.slice(0, 30).forEach((error) => console.error(`  ${error}`));
    process.exitCode = 1;
  } else console.log(`${file} matches the current Northflank resource schema.`);
}

function validateValue(value, shape, root, path, errors, seen = new Set()) {
  if (!shape || errors.length > 100) return;
  if (shape.$ref) {
    const recursiveNode = shape.$ref.endsWith("TemplateNodeSchema");
    if (seen.has(shape.$ref) && !recursiveNode) return;
    const target = resolveRef(root, shape.$ref);
    if (!target) return;
    const nextSeen = recursiveNode ? new Set([shape.$ref]) : new Set(seen); nextSeen.add(shape.$ref);
    return validateValue(value, target, root, path, errors, nextSeen);
  }
  const alternatives = shape.oneOf ?? shape.anyOf;
  if (alternatives) {
    const attempts = alternatives.map((option) => { const local = []; validateValue(value, option, root, path, local, seen); return local; });
    const best = attempts.find((attempt) => attempt.length === 0);
    if (!best) errors.push(...attempts.sort((a, b) => a.length - b.length)[0]);
    return;
  }
  if (shape.const !== undefined && value !== shape.const) errors.push(`${path} must equal ${JSON.stringify(shape.const)}`);
  if (shape.enum && !shape.enum.includes(value)) errors.push(`${path} must be one of ${shape.enum.join(", ")}`);
  const types = Array.isArray(shape.type) ? shape.type : shape.type ? [shape.type] : [];
  if (types.length && !types.some((type) => matchesType(value, type))) { errors.push(`${path} has the wrong type`); return; }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateValue(entry, shape.items, root, `${path}/${index}`, errors, seen));
    return;
  }
  if (value && typeof value === "object") {
    for (const required of shape.required ?? []) if (!(required in value)) errors.push(`${path}/${required} is required`);
    for (const [key, child] of Object.entries(value)) {
      const patternShape = Object.entries(shape.patternProperties ?? {}).find(([pattern]) => new RegExp(pattern).test(key))?.[1];
      const childShape = shape.properties?.[key] ?? patternShape;
      if (!childShape && shape.additionalProperties === false) errors.push(`${path}/${key} is not allowed`);
      else if (childShape) validateValue(child, childShape, root, `${path}/${key}`, errors, seen);
    }
  }
}

function resolveRef(root, ref) {
  if (!ref.startsWith("#/")) return undefined;
  return ref.slice(2).split("/").reduce((value, key) => value?.[key.replaceAll("~1", "/").replaceAll("~0", "~")], root);
}

function matchesType(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number";
  if (type === "boolean") return typeof value === "boolean";
  if (type === "string" || type === "objectId") return typeof value === "string";
  return true;
}
