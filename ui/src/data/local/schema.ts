/**
 * Runtime schema validation of LOCAL_RESEARCH responses against the frozen contract.
 *
 * The schemas are a verbatim copy of the 33 frozen schemas reachable from the two authorized
 * endpoints (src/data/contract/v1.schemas.json, produced by scripts/phase2/extract_schemas.py and
 * proven equal to the frozen OpenAPI by src/test/contract-drift-runtime.test.ts).
 *
 * This is deliberately a small validator for exactly the keywords those schemas use. A keyword it
 * does not implement is a validation failure, never silently ignored — so a contract change that
 * adds one fails closed until the validator is reviewed.
 *
 * Member lookups use OWN-property semantics only (P3A-AUD-002): a JSON member named "constructor",
 * "toString", "__proto__" or anything else found on Object.prototype is declared only if the schema's own
 * `properties` names it, so an undeclared one is refused under `additionalProperties: false`. The same
 * rule resolves `$ref` targets and schema names. Malformed keyword values (non-object `properties`,
 * non-string-array `required`, an `additionalProperties` other than true/false) fail closed.
 *
 * Limits (documented in docs/phase2/API_PROVIDER_MAPPING.md): it validates the value JSON.parse
 * produced, so it cannot see duplicate object keys or tell `1.0` from `1` in the raw bytes, and
 * `format: date-time` is checked as RFC 3339 by pattern plus Date.parse.
 */
import contract from "../contract/v1.schemas.json";

type Schema = Record<string, unknown>;
const SCHEMAS = contract.schemas as unknown as Record<string, Schema>;

export const SCHEMA_SOURCE = { file: contract.source, sha256: contract.source_sha256, contractVersion: contract.contract_version, count: Object.keys(SCHEMAS).length };

export interface SchemaError {
  path: string;
  message: string;
}

const HANDLED = new Set([
  "$ref",
  "type",
  "enum",
  "const",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "pattern",
  "uniqueItems",
  "format",
  "description",
  "default",
]);

const RFC3339 = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;
const MAX_ERRORS = 25;

/** Stable text of a JSON value with sorted keys; used only for equality (enum, const, uniqueItems). */
export function stableJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
    .join(",")}}`;
}

/** Own-property membership; never consults the prototype chain (P3A-AUD-002). */
const own = (o: object, k: string): boolean => Object.hasOwn(o, k);

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function typeMatches(t: string, v: unknown): boolean {
  switch (t) {
    case "null":
      return v === null;
    case "boolean":
      return typeof v === "boolean";
    case "string":
      return typeof v === "string";
    case "integer":
      return typeof v === "number" && Number.isInteger(v);
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "array":
      return Array.isArray(v);
    case "object":
      return typeof v === "object" && v !== null && !Array.isArray(v);
    default:
      return false;
  }
}

/**
 * A validator over one verbatim schema map. The frozen slice (v1.schemas.json) and the Phase 3A additive
 * history slice (../contract/history.schemas.json) each get their own instance; `$ref` resolves only
 * inside the map it was created with, so neither slice can borrow a schema from the other.
 */
export function createSchemaValidator(schemas: Record<string, Schema>, scopeLabel = "the authorized slice") {
  function check(schema: Schema, v: unknown, path: string, errors: SchemaError[]): void {
    if (errors.length >= MAX_ERRORS) return;
    const fail = (message: string) => errors.push({ path: path || "$", message });
    for (const k of Object.keys(schema)) if (!HANDLED.has(k)) return void fail(`unsupported schema keyword "${k}"`);

    if (own(schema, "$ref")) {
      const ref = schema.$ref;
      const name = typeof ref === "string" ? ref.replace("#/components/schemas/", "") : "";
      if (typeof ref !== "string" || ref !== `#/components/schemas/${name}` || !own(schemas, name) || !isPlainObject(schemas[name])) return void fail(`unresolvable $ref ${String(ref)}`);
      check(schemas[name], v, path, errors);
    }
    if (schema.type !== undefined) {
      const types = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
      if (!types.some((t) => typeMatches(t, v))) return void fail(`expected ${types.join(" | ")}, got ${v === null ? "null" : Array.isArray(v) ? "array" : typeof v}`);
    }
    if (schema.const !== undefined && stableJson(schema.const) !== stableJson(v)) fail(`expected const ${JSON.stringify(schema.const)}`);
    if (Array.isArray(schema.enum) && !schema.enum.some((e) => stableJson(e) === stableJson(v))) fail(`value ${JSON.stringify(v)} not in enum`);

    if (typeof v === "string") {
      const len = [...v].length;
      if (typeof schema.minLength === "number" && len < schema.minLength) fail(`shorter than ${schema.minLength}`);
      if (typeof schema.maxLength === "number" && len > schema.maxLength) fail(`longer than ${schema.maxLength}`);
      if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(v)) fail(`does not match ${schema.pattern}`);
      if (schema.format === "date-time" && !(RFC3339.test(v) && !Number.isNaN(Date.parse(v)))) fail("not an RFC 3339 date-time");
      else if (schema.format !== undefined && schema.format !== "date-time") fail(`unsupported format ${String(schema.format)}`);
    }
    if (typeof v === "number") {
      if (typeof schema.minimum === "number" && v < schema.minimum) fail(`below minimum ${schema.minimum}`);
      if (typeof schema.maximum === "number" && v > schema.maximum) fail(`above maximum ${schema.maximum}`);
    }
    if (Array.isArray(v)) {
      if (typeof schema.minItems === "number" && v.length < schema.minItems) fail(`fewer than ${schema.minItems} items`);
      if (typeof schema.maxItems === "number" && v.length > schema.maxItems) fail(`more than ${schema.maxItems} items`);
      if (schema.uniqueItems === true && new Set(v.map(stableJson)).size !== v.length) fail("items are not unique");
      if (schema.items && typeof schema.items === "object") v.forEach((item, i) => check(schema.items as Schema, item, `${path}[${i}]`, errors));
    }
    if (typeMatches("object", v)) {
      const o = v as Record<string, unknown>;
      if (own(schema, "properties") && !isPlainObject(schema.properties)) return void fail("malformed schema: properties is not an object");
      if (own(schema, "required") && !(Array.isArray(schema.required) && schema.required.every((r) => typeof r === "string"))) return void fail("malformed schema: required is not a list of names");
      if (own(schema, "additionalProperties") && typeof schema.additionalProperties !== "boolean") return void fail("unsupported schema keyword form: additionalProperties must be true or false");
      const props = (own(schema, "properties") ? schema.properties : {}) as Record<string, unknown>;
      for (const req of (own(schema, "required") ? schema.required : []) as string[]) if (!own(o, req)) fail(`missing required key "${req}"`);
      for (const k of Object.keys(o)) {
        const declared = own(props, k) ? props[k] : undefined;
        if (declared !== undefined) {
          if (!isPlainObject(declared)) fail(`malformed schema: property "${k}" is not a schema`);
          else check(declared, o[k], `${path}.${k}`, errors);
        } else if (schema.additionalProperties === false) fail(`unexpected key "${k}"`);
      }
    }
  }

  return function validate(name: string, value: unknown): SchemaError[] {
    if (!own(schemas, name) || !isPlainObject(schemas[name])) return [{ path: "$", message: `schema ${name} is not part of ${scopeLabel}` }];
    const schema = schemas[name];
    const errors: SchemaError[] = [];
    check(schema, value, "", errors);
    return errors;
  };
}

/** Validate a parsed JSON value against one frozen schema by name. An empty list means valid. */
export const validateSchema = createSchemaValidator(SCHEMAS);
