/**
 * A validator for the part of JSON Schema draft 2020-12 that the report schemas use (docs/schema/), for the tests.
 * It is offline/bench/json_schema.py in TypeScript, keyword for keyword, and both run the cases of
 * offline/bench/json_schema_cases.json. An unsupported keyword throws SchemaError, so a schema cannot rely on
 * something this validator would silently ignore.
 *
 * Instances are values from JSON.parse. A whole number of any size is an integer; a pattern is compiled with the "u"
 * flag, as JSON Schema recommends.
 */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Schema = boolean | { [keyword: string]: unknown };

const ANNOTATIONS = new Set(["$schema", "$id", "$defs", "title", "description", "$comment"]);
const KEYWORDS = new Set([
  "type", "const", "enum", "minimum", "pattern", "required", "properties", "patternProperties", "additionalProperties",
  "dependentRequired", "items", "minItems", "maxItems", "allOf", "anyOf", "oneOf", "not", "if", "then", "else", "$ref",
]);

export class SchemaError extends Error {}

const isObject = (v: unknown): v is { [key: string]: Json } => typeof v === "object" && v !== null && !Array.isArray(v);

function isType(value: Json, name: string): boolean {
  switch (name) {
    case "null": return value === null;
    case "boolean": return typeof value === "boolean";
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "number": return typeof value === "number";
    case "string": return typeof value === "string";
    case "array": return Array.isArray(value);
    case "object": return isObject(value);
    default: throw new SchemaError(`unknown type ${JSON.stringify(name)}`);
  }
}

/** Equality as JSON has it: true is not 1, and structures are compared deeply. */
export function jsonEqual(a: Json, b: Json): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => jsonEqual(x, b[i]!));
  if (isObject(a) || isObject(b)) {
    if (!isObject(a) || !isObject(b)) return false;
    const names = Object.keys(a);
    return names.length === Object.keys(b).length && names.every((k) => Object.hasOwn(b, k) && jsonEqual(a[k]!, b[k]!));
  }
  return a === b;
}

const patterns = new Map<string, RegExp>();
function pattern(text: string): RegExp {
  let compiled = patterns.get(text);
  if (!compiled) {
    try {
      compiled = new RegExp(text, "u");
    } catch (e) {
      throw new SchemaError(`pattern ${JSON.stringify(text)} does not compile (${(e as Error).message})`);
    }
    patterns.set(text, compiled);
  }
  return compiled;
}

const show = (value: unknown) => {
  const text = JSON.stringify(value) ?? String(value);
  return text.length <= 60 ? text : text.slice(0, 57) + "...";
};

class Run {
  readonly seen = new Set<string>();
  private readonly root: Schema;
  constructor(root: Schema) {
    this.root = root;
  }

  private resolve(pointer: unknown): Schema {
    if (typeof pointer !== "string" || !pointer.startsWith("#/$defs/")) throw new SchemaError(`$ref ${show(pointer)} is not #/$defs/NAME`);
    const definitions = (typeof this.root === "object" ? this.root.$defs : undefined) as Record<string, Schema> | undefined;
    const name = pointer.slice("#/$defs/".length);
    if (!definitions || !Object.hasOwn(definitions, name)) throw new SchemaError(`$ref ${show(pointer)} names no definition`);
    return definitions[name]!;
  }

  check(schema: Schema, value: Json, path: string): string[] {
    if (schema === true) return [];
    if (schema === false) return [`${path}: nothing is allowed here`];
    if (typeof schema !== "object" || schema === null || Array.isArray(schema)) throw new SchemaError(`a schema must be an object or a boolean, not ${show(schema)}`);
    const unknown = Object.keys(schema).filter((k) => !KEYWORDS.has(k) && !ANNOTATIONS.has(k)).sort();
    if (unknown.length) throw new SchemaError(`unsupported keyword ${unknown.join(", ")}`);
    const s = schema as Record<string, unknown>;
    const errors: string[] = [];
    if ("$ref" in s) errors.push(...this.check(this.resolve(s.$ref), value, path));
    if ("type" in s) {
      const names = (Array.isArray(s.type) ? s.type : [s.type]) as string[];
      if (!names.some((name) => isType(value, name))) errors.push(`${path}: must be ${names.join(" or ")}, not ${show(value)}`);
    }
    if ("const" in s && !jsonEqual(value, s.const as Json)) errors.push(`${path}: must be ${show(s.const)}, not ${show(value)}`);
    if ("enum" in s && !(s.enum as Json[]).some((item) => jsonEqual(value, item))) errors.push(`${path}: must be one of ${show(s.enum)}, not ${show(value)}`);
    if ("minimum" in s && typeof value === "number" && value < (s.minimum as number)) errors.push(`${path}: must be at least ${s.minimum as number}, not ${show(value)}`);
    if ("pattern" in s && typeof value === "string" && !pattern(s.pattern as string).test(value)) errors.push(`${path}: ${show(value)} does not match ${s.pattern as string}`);
    if (isObject(value)) errors.push(...this.object(s, value, path));
    if (Array.isArray(value)) {
      if ("minItems" in s && value.length < (s.minItems as number)) errors.push(`${path}: must have at least ${s.minItems as number} items, not ${value.length}`);
      if ("maxItems" in s && value.length > (s.maxItems as number)) errors.push(`${path}: must have at most ${s.maxItems as number} items, not ${value.length}`);
      if ("items" in s) value.forEach((item, i) => errors.push(...this.check(s.items as Schema, item, `${path}[${i}]`)));
    }
    for (const sub of (s.allOf ?? []) as Schema[]) errors.push(...this.check(sub, value, path));
    if ("anyOf" in s) {
      const results = (s.anyOf as Schema[]).map((sub) => this.check(sub, value, path));
      if (results.every((r) => r.length)) errors.push(`${path}: matches none of the alternatives (${results.map((r) => r[0]).join("; ")})`);
    }
    if ("oneOf" in s) {
      const results = (s.oneOf as Schema[]).map((sub) => this.check(sub, value, path));
      const valid = results.filter((r) => !r.length).length;
      if (valid === 0) errors.push(`${path}: matches none of the alternatives (${results.map((r) => r[0]).join("; ")})`);
      else if (valid > 1) errors.push(`${path}: matches ${valid} alternatives, and exactly one is allowed`);
    }
    if ("not" in s && !this.check(s.not as Schema, value, path).length) errors.push(`${path}: matches what is not allowed here`);
    if ("if" in s) {
      const branch = this.check(s.if as Schema, value, path).length ? "else" : "then";
      if (branch in s) errors.push(...this.check(s[branch] as Schema, value, path));
    }
    return errors;
  }

  private object(s: Record<string, unknown>, value: { [key: string]: Json }, path: string): string[] {
    const errors: string[] = [];
    for (const name of (s.required ?? []) as string[]) if (!Object.hasOwn(value, name)) errors.push(`${path}: ${name} is missing`);
    for (const [name, needed] of Object.entries((s.dependentRequired ?? {}) as Record<string, string[]>)) {
      if (!Object.hasOwn(value, name)) continue;
      for (const other of needed) if (!Object.hasOwn(value, other)) errors.push(`${path}: ${other} is missing, and ${name} needs it`);
    }
    const properties = (s.properties ?? {}) as Record<string, Schema>;
    const patternProperties = (s.patternProperties ?? {}) as Record<string, Schema>;
    for (const [name, item] of Object.entries(value)) {
      const where = path ? `${path}.${name}` : name;
      let matched = false;
      if (Object.hasOwn(properties, name)) {
        matched = true;
        this.seen.add(`${path}\u0000${name}`);
        errors.push(...this.check(properties[name]!, item, where));
      }
      for (const [p, sub] of Object.entries(patternProperties)) {
        if (!pattern(p).test(name)) continue;
        matched = true;
        this.seen.add(`${path}\u0000${name}`);
        errors.push(...this.check(sub, item, where));
      }
      if (!matched && "additionalProperties" in s) {
        const extra = s.additionalProperties as Schema;
        if (extra !== false) this.seen.add(`${path}\u0000${name}`);
        errors.push(...(extra === false ? [`${path}: ${name} is not allowed`] : this.check(extra, item, where)));
      }
    }
    return errors;
  }
}

/** The errors of `instance` against `schema`, each "PATH: what is wrong"; empty when it is valid. */
export const validate = (schema: Schema, instance: Json): string[] => new Run(schema).check(schema, instance, "");

/** The members of `instance`, as paths, that no properties, patternProperties or additionalProperties keyword names. */
export function undeclared(schema: Schema, instance: Json): string[] {
  const run = new Run(schema);
  run.check(schema, instance, "");
  const missing: string[] = [];
  const walk = (value: Json, path: string) => {
    if (Array.isArray(value)) value.forEach((item, i) => walk(item, `${path}[${i}]`));
    else if (isObject(value)) {
      for (const [name, item] of Object.entries(value)) {
        const where = path ? `${path}.${name}` : name;
        if (!run.seen.has(`${path}\u0000${name}`)) missing.push(where);
        walk(item, where);
      }
    }
  };
  walk(instance, "");
  return missing;
}
