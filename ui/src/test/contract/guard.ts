/**
 * Contract drift guard — compares the wire mirror (src/data/contract/v1.ts) with the reviewed OpenAPI.
 *
 * Both sides are reduced to the same normalized shape, and the shapes are compared:
 *   mirror    parsed from the real v1.ts source with the TypeScript compiler API (no hand-kept copy);
 *   contract  read from the OpenAPI document as given (no second, invented specification).
 *
 * What a shape captures (the material properties a decoder will depend on):
 *   field names · required vs optional · types · nullability · enum values · const values ·
 *   nested inline objects · array item types · $ref targets · closed objects (additionalProperties: false).
 * Keywords on one schema are combined, never chosen between: an enum or const is intersected with the
 * schema's `type`, and a value the type excludes, or an empty result, is reported. Keywords beside a
 * `$ref` (other than annotations) are reported, wherever the `$ref` sits — components, parameters or
 * response bodies.
 *
 * What it deliberately does not capture, because TypeScript cannot express it in the mirror:
 *   integer vs number · minimum / maximum · minLength / maxLength · pattern · format ·
 *   minItems / maxItems / uniqueItems · default · description. These are value constraints that the
 *   Phase 2 decoder must enforce at runtime; `IGNORED_KEYWORDS` lists them. Any other JSON Schema
 *   keyword (oneOf, allOf, patternProperties, …) is reported as unsupported, never skipped.
 *
 * Scope: the schemas reachable from the two Phase 1 endpoints and the Error envelope, their path and
 * query parameters, and their response bindings (200 → root schema, 4xx/5xx → Error, JSON only; any
 * other status or media type is reported). Response headers (Cache-Control) are not compared. It is
 * not a check of the whole OpenAPI document and says nothing about runtime HTTP compatibility.
 */
import ts from "typescript";

/* ---------- Normalized shape ---------- */

export type Shape =
  | { t: "string" }
  | { t: "number" }
  | { t: "boolean" }
  | { t: "null" }
  | { t: "unknown" }
  | { t: "lit"; v: string | number | boolean }
  | { t: "array"; items: Shape }
  | { t: "object"; props: Record<string, Prop>; closed: boolean }
  | { t: "union"; of: Shape[] }
  /** Reference to an object schema, compared by name (each object schema is compared on its own). */
  | { t: "ref"; name: string }
  /** Reference to a scalar schema (State, Digest, Timestamp, …): compared by name and expansion. */
  | { t: "alias"; name: string; shape: Shape };

export interface Prop {
  optional: boolean;
  shape: Shape;
}

export const show = (s: Shape): string => {
  switch (s.t) {
    case "lit":
      return JSON.stringify(s.v);
    case "array":
      return `${s.items.t === "union" ? `(${show(s.items)})` : show(s.items)}[]`;
    case "object":
      return `{ ${Object.entries(s.props)
        .map(([k, p]) => `${k}${p.optional ? "?" : ""}: ${show(p.shape)}`)
        .join("; ")}${s.closed ? "" : "; …open"} }`;
    case "union":
      return s.of.length ? s.of.map(show).join(" | ") : "never";
    case "ref":
      return `$ref ${s.name}`;
    case "alias":
      return `$ref ${s.name} (${show(s.shape)})`;
    default:
      return s.t;
  }
};

const key = (s: Shape) => show(s);

/** Flatten nested unions, expand scalar aliases inside them, dedupe and sort. One member → that member. */
function union(members: Shape[]): Shape {
  const flat: Shape[] = [];
  const add = (m: Shape) => {
    if (m.t === "union") m.of.forEach(add);
    else if (m.t === "alias" && members.length > 1) add(m.shape);
    else flat.push(m);
  };
  members.forEach(add);
  const byKey = new Map(flat.map((m) => [key(m), m]));
  const of = [...byKey.keys()].sort().map((k) => byKey.get(k)!);
  return of.length === 1 ? of[0]! : { t: "union", of };
}

/* ---------- Mirror side: parse v1.ts ---------- */

export interface Mirror {
  /** Contract schema name → shape, for every v1.ts declaration that mirrors a contract schema. */
  schemas: Map<string, Shape>;
  /** Every exported interface and type alias in v1.ts. */
  names: string[];
  /** Shape of any exported interface or type alias in v1.ts, by declaration name. */
  declaration: (name: string) => Shape | undefined;
}

/**
 * A declaration mirrors the contract schema whose name it carries: `XxxDTO` and `Xxx` both mirror
 * schema `Xxx`. Other aliases (e.g. EvidenceAvailability) are local names for inline types and are
 * expanded where they are used.
 */
const schemaNameOf = (decl: string, contractNames: ReadonlySet<string>) => {
  const stem = decl.endsWith("DTO") ? decl.slice(0, -3) : decl;
  return contractNames.has(stem) ? stem : null;
};

export function readMirror(source: string, contractNames: ReadonlySet<string>): Mirror {
  const file = ts.createSourceFile("v1.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const decls = new Map<string, ts.InterfaceDeclaration | ts.TypeAliasDeclaration>();
  // Exported declarations only: helpers such as the key-list `Keys<T>` are not wire types.
  const exported = (st: ts.Statement) => ts.canHaveModifiers(st) && !!ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  for (const st of file.statements) if ((ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) && exported(st)) decls.set(st.name.text, st);

  const fail = (node: ts.Node, what: string): never => {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart());
    throw new Error(`v1.ts:${line + 1}: unsupported ${what} in the wire mirror: ${node.getText()}`);
  };

  // An interface or type literal is closed: it names every key the mirror accepts.
  const members = (list: ts.NodeArray<ts.TypeElement>): Shape => {
    const props: Record<string, Prop> = {};
    for (const m of list) {
      if (!ts.isPropertySignature(m) || !m.type) return fail(m, "member");
      const name = ts.isIdentifier(m.name) || ts.isStringLiteral(m.name) ? m.name.text : fail(m.name, "property name");
      props[name] = { optional: !!m.questionToken, shape: typeOf(m.type) };
    }
    return { t: "object", props, closed: true };
  };

  const declShape = (d: ts.InterfaceDeclaration | ts.TypeAliasDeclaration): Shape => {
    if (ts.isInterfaceDeclaration(d)) {
      if (d.heritageClauses?.length || d.typeParameters?.length) return fail(d, "interface form");
      return members(d.members);
    }
    if (d.typeParameters?.length) return fail(d, "generic alias");
    return typeOf(d.type);
  };

  function typeOf(n: ts.TypeNode): Shape {
    switch (n.kind) {
      case ts.SyntaxKind.StringKeyword:
        return { t: "string" };
      case ts.SyntaxKind.NumberKeyword:
        return { t: "number" };
      case ts.SyntaxKind.BooleanKeyword:
        return { t: "boolean" };
      case ts.SyntaxKind.UnknownKeyword:
        return { t: "unknown" };
      case ts.SyntaxKind.NullKeyword:
        return { t: "null" };
    }
    if (ts.isParenthesizedTypeNode(n)) return typeOf(n.type);
    if (ts.isUnionTypeNode(n)) return union(n.types.map(typeOf));
    if (ts.isArrayTypeNode(n)) return { t: "array", items: typeOf(n.elementType) };
    if (ts.isTypeLiteralNode(n)) return members(n.members);
    if (ts.isLiteralTypeNode(n)) {
      const l = n.literal;
      if (l.kind === ts.SyntaxKind.NullKeyword) return { t: "null" };
      if (l.kind === ts.SyntaxKind.TrueKeyword) return { t: "lit", v: true };
      if (l.kind === ts.SyntaxKind.FalseKeyword) return { t: "lit", v: false };
      if (ts.isStringLiteral(l)) return { t: "lit", v: l.text };
      if (ts.isNumericLiteral(l)) return { t: "lit", v: Number(l.text) };
      return fail(n, "literal");
    }
    if (ts.isTypeReferenceNode(n) && ts.isIdentifier(n.typeName)) {
      const name = n.typeName.text;
      if (name === "Array" && n.typeArguments?.length === 1) return { t: "array", items: typeOf(n.typeArguments[0]!) };
      const d = decls.get(name);
      if (!d || n.typeArguments?.length) return fail(n, "type reference");
      const schema = schemaNameOf(name, contractNames);
      if (schema && ts.isInterfaceDeclaration(d)) return { t: "ref", name: schema };
      if (schema) return { t: "alias", name: schema, shape: declShape(d) };
      return declShape(d);
    }
    return fail(n, "type");
  }

  const schemas = new Map<string, Shape>();
  for (const [name, d] of decls) {
    const schema = schemaNameOf(name, contractNames);
    if (!schema) continue;
    if (schemas.has(schema)) throw new Error(`v1.ts: two declarations mirror schema ${schema}`);
    schemas.set(schema, declShape(d));
  }
  return {
    schemas,
    names: [...decls.keys()],
    declaration: (name) => {
      const d = decls.get(name);
      return d ? declShape(d) : undefined;
    },
  };
}

/* ---------- Contract side: normalize OpenAPI JSON Schema ---------- */

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type JsonSchema = { [k: string]: Json };

export interface OpenApiDoc {
  info: { version: string };
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, JsonSchema> };
}

/** Value constraints and annotations the TypeScript mirror cannot express. See the file header. */
export const IGNORED_KEYWORDS = new Set([
  "description",
  "title",
  "examples",
  "default",
  "format",
  "pattern",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minItems",
  "maxItems",
  "uniqueItems",
]);
const SHAPE_KEYWORDS = new Set(["type", "enum", "const", "$ref", "properties", "required", "additionalProperties", "items"]);

const REF = "#/components/schemas/";
const TYPES = new Set(["string", "integer", "number", "boolean", "null", "array", "object"]);
/** Whether a JSON value is an instance of a JSON Schema `type` name. */
const admits = (type: string, v: Json) => {
  switch (type) {
    case "null":
      return v === null;
    case "integer":
      return Number.isInteger(v);
    case "array":
      return Array.isArray(v);
    case "object":
      return v !== null && typeof v === "object" && !Array.isArray(v);
    default:
      return typeof v === type;
  }
};
const isObjectSchema = (s: JsonSchema | undefined) => !!s && (s.type === "object" || "properties" in s);

export class ContractReader {
  readonly problems: string[] = [];
  private readonly doc: OpenApiDoc;
  constructor(doc: OpenApiDoc) {
    this.doc = doc;
  }

  get names(): ReadonlySet<string> {
    return new Set(Object.keys(this.doc.components.schemas));
  }

  schema(name: string): Shape | null {
    const s = this.doc.components.schemas[name];
    return s ? this.shape(s, name) : null;
  }

  /** Names of the schemas a schema refers to directly. */
  refsOf(s: Json): string[] {
    if (Array.isArray(s)) return s.flatMap((x) => this.refsOf(x));
    if (!s || typeof s !== "object") return [];
    const own = typeof s.$ref === "string" && s.$ref.startsWith(REF) ? [s.$ref.slice(REF.length)] : [];
    return [...own, ...Object.values(s).flatMap((v) => this.refsOf(v))];
  }

  shape(s: JsonSchema, at: string): Shape {
    for (const k of Object.keys(s))
      if (!SHAPE_KEYWORDS.has(k) && !IGNORED_KEYWORDS.has(k) && !k.startsWith("x-")) this.problems.push(`${at}: unsupported JSON Schema keyword "${k}"`);

    if (typeof s.$ref === "string") {
      // In OpenAPI 3.1 siblings of $ref apply too (they narrow the target), so they cannot be ignored.
      const siblings = Object.keys(s).filter((k) => k !== "$ref" && !IGNORED_KEYWORDS.has(k));
      if (siblings.length) this.problems.push(`${at}: $ref with sibling keywords (${siblings.join(", ")})`);
      if (!s.$ref.startsWith(REF)) {
        this.problems.push(`${at}: non-local $ref ${s.$ref}`);
        return { t: "unknown" };
      }
      const name = s.$ref.slice(REF.length);
      const target = this.doc.components.schemas[name];
      if (!target) {
        this.problems.push(`${at}: dangling $ref ${name}`);
        return { t: "ref", name };
      }
      return isObjectSchema(target) ? { t: "ref", name } : { t: "alias", name, shape: this.shape(target, name) };
    }

    const types = s.type === undefined ? null : Array.isArray(s.type) ? s.type : [s.type];
    for (const t of types ?? []) if (typeof t !== "string" || !TYPES.has(t)) this.problems.push(`${at}: unknown type ${String(t)}`);
    if ("const" in s || "enum" in s) {
      // A value must satisfy every keyword: the permitted set is const ∩ enum ∩ type, never just one of them.
      if ("enum" in s && !Array.isArray(s.enum)) {
        this.problems.push(`${at}: enum is not an array`);
        return { t: "unknown" };
      }
      const same = (a: Json, b: Json) => JSON.stringify(a) === JSON.stringify(b);
      let values = "const" in s ? [s.const] : (s.enum as Json[]);
      if ("const" in s && Array.isArray(s.enum)) {
        const listed = s.enum;
        for (const v of values) if (!listed.some((e) => same(e, v))) this.problems.push(`${at}: const ${JSON.stringify(v)} is not in enum`);
        values = values.filter((v) => listed.some((e) => same(e, v)));
      }
      if (types) {
        for (const v of values) if (!types.some((t) => admits(String(t), v))) this.problems.push(`${at}: ${"const" in s ? "const" : "enum value"} ${JSON.stringify(v)} is not of type ${types.join(" | ")}`);
        values = values.filter((v) => types.some((t) => admits(String(t), v)));
      }
      if (values.some((v) => v !== null && typeof v === "object")) {
        this.problems.push(`${at}: non-scalar ${"const" in s ? "const" : "enum value"}`);
        return { t: "unknown" };
      }
      if (!values.length) this.problems.push(`${at}: no value satisfies type, enum and const together`);
      return union(values.map((v): Shape => (v === null ? { t: "null" } : { t: "lit", v: v as string | number | boolean })));
    }
    if (!types) {
      if ("properties" in s) return this.object(s, at);
      if ("items" in s) this.problems.push(`${at}: items without type`);
      return { t: "unknown" };
    }
    return union(
      types.map((t): Shape => {
        switch (t) {
          case "string":
            return { t: "string" };
          case "integer":
          case "number":
            return { t: "number" };
          case "boolean":
            return { t: "boolean" };
          case "null":
            return { t: "null" };
          case "array":
            if (!s.items || typeof s.items !== "object" || Array.isArray(s.items)) {
              this.problems.push(`${at}: array without a single items schema`);
              return { t: "array", items: { t: "unknown" } };
            }
            return { t: "array", items: this.shape(s.items, `${at}[]`) };
          case "object":
            return this.object(s, at);
          default:
            this.problems.push(`${at}: unknown type ${String(t)}`);
            return { t: "unknown" };
        }
      }),
    );
  }

  private object(s: JsonSchema, at: string): Shape {
    const props = (s.properties ?? {}) as Record<string, JsonSchema>;
    const required = new Set(Array.isArray(s.required) ? (s.required as string[]) : []);
    for (const r of required) if (!(r in props)) this.problems.push(`${at}: required key "${r}" has no property`);
    if (s.additionalProperties !== undefined && typeof s.additionalProperties !== "boolean")
      this.problems.push(`${at}: additionalProperties schema (map type) is not mirrored`);
    const out: Record<string, Prop> = {};
    for (const [k, v] of Object.entries(props)) out[k] = { optional: !required.has(k), shape: this.shape(v, `${at}.${k}`) };
    return { t: "object", props: out, closed: s.additionalProperties === false };
  }
}

/* ---------- Comparison ---------- */

/** Differences between a mirror shape and a contract shape, as readable lines. Empty means equal. */
export function diffShapes(mirror: Shape, contract: Shape, at: string): string[] {
  if (mirror.t === "alias" && contract.t === "alias") {
    // Each scalar schema is compared on its own; here only the reference target matters.
    return mirror.name === contract.name ? [] : [`${at}: $ref target — mirror ${mirror.name}, contract ${contract.name}`];
  }
  if (mirror.t === "alias") return diffShapes(mirror.shape, contract, at);
  if (contract.t === "alias") return diffShapes(mirror, contract.shape, at);

  if (mirror.t !== contract.t) {
    const nullOnly = (a: Shape, b: Shape) => a.t === "union" && key(union(a.of.filter((m) => m.t !== "null"))) === key(b);
    const what = nullOnly(mirror, contract) || nullOnly(contract, mirror) ? "nullability" : "type";
    return [`${at}: ${what} — mirror ${show(mirror)}, contract ${show(contract)}`];
  }
  switch (mirror.t) {
    case "lit":
      return mirror.v === (contract as typeof mirror).v ? [] : [`${at}: const — mirror ${show(mirror)}, contract ${show(contract)}`];
    case "ref":
      return mirror.name === (contract as typeof mirror).name ? [] : [`${at}: $ref target — mirror ${mirror.name}, contract ${(contract as typeof mirror).name}`];
    case "array":
      return diffShapes(mirror.items, (contract as typeof mirror).items, `${at}[]`);
    case "union": {
      const c = contract as typeof mirror;
      const mk = new Set(mirror.of.map(key));
      const ck = new Set(c.of.map(key));
      const out: string[] = [];
      const label = (k: string) => (k === "null" ? "nullability" : k.startsWith('"') || /^[\d-]|^true$|^false$/.test(k) ? "enum value" : "union member");
      for (const k of ck) if (!mk.has(k)) out.push(`${at}: ${label(k)} ${k} in contract, not in mirror`);
      for (const k of mk) if (!ck.has(k)) out.push(`${at}: ${label(k)} ${k} in mirror, not in contract`);
      return out;
    }
    case "object": {
      const c = contract as typeof mirror;
      const out: string[] = [];
      if (mirror.closed !== c.closed) out.push(`${at}: additionalProperties — mirror is ${mirror.closed ? "closed" : "open"}, contract is ${c.closed ? "closed" : "open"}`);
      for (const k of Object.keys(c.props)) if (!(k in mirror.props)) out.push(`${at}.${k}: property in contract, not in mirror`);
      for (const [k, p] of Object.entries(mirror.props)) {
        const cp = c.props[k];
        if (!cp) {
          out.push(`${at}.${k}: property in mirror, not in contract`);
          continue;
        }
        if (p.optional !== cp.optional) out.push(`${at}.${k}: required — mirror ${p.optional ? "optional" : "required"}, contract ${cp.optional ? "optional" : "required"}`);
        out.push(...diffShapes(p.shape, cp.shape, `${at}.${k}`));
      }
      return out;
    }
    default:
      return [];
  }
}

/* ---------- Whole-scope check ---------- */

export interface Binding {
  version: string;
  /** Endpoint key → path template, e.g. verification → /api/v1/verifications/{id}. */
  paths: Record<string, string>;
  /** Endpoint key → contract schema of its 200 body. */
  roots: Record<string, string>;
  /** Endpoint key → v1.ts declaration that mirrors its query parameters. */
  queries: Record<string, string>;
  /** Contract schema every error response uses. */
  error: string;
}

export interface Report {
  /** Every difference found. Empty means the mirror matches the contract within the stated scope. */
  diffs: string[];
  /** Schemas compared, sorted. */
  compared: string[];
  /** Schemas reachable from the endpoints (the scope the mirror must cover), sorted. */
  inScope: string[];
}

interface Parameter {
  name: string;
  in: string;
  required?: boolean;
  schema?: JsonSchema;
}

export function checkContract(doc: OpenApiDoc, mirrorSource: string, binding: Binding): Report {
  const reader = new ContractReader(doc);
  const diffs: string[] = [];
  let mirror: Mirror;
  try {
    mirror = readMirror(mirrorSource, reader.names);
  } catch (e) {
    return { diffs: [(e as Error).message], compared: [], inScope: [] };
  }

  if (doc.info.version !== binding.version) diffs.push(`info.version — mirror ${binding.version}, contract ${doc.info.version}`);

  // Scope: every schema reachable from the endpoints' responses and the error envelope.
  const inScope = new Set<string>();
  const visit = (name: string) => {
    if (inScope.has(name)) return;
    inScope.add(name);
    const s = doc.components.schemas[name];
    if (s) reader.refsOf(s).forEach(visit);
  };
  [...Object.values(binding.roots), binding.error].forEach(visit);
  for (const name of [...inScope].sort()) if (!mirror.schemas.has(name)) diffs.push(`${name}: schema in scope of the contract, not mirrored`);
  for (const name of [...mirror.schemas.keys()].sort()) if (!inScope.has(name)) diffs.push(`${name}: mirrored, but not reachable from the Phase 1 endpoints in the contract`);

  // A DTO whose schema has disappeared from the contract (query mirrors are bound to parameters instead).
  const queryDecls = new Set(Object.values(binding.queries));
  for (const name of mirror.names)
    if (name.endsWith("DTO") && !queryDecls.has(name) && !reader.names.has(name.slice(0, -3))) diffs.push(`${name.slice(0, -3)}: mirrored (${name}), but absent from the contract`);

  const compared: string[] = [];
  for (const [name, m] of [...mirror.schemas].sort(([a], [b]) => a.localeCompare(b))) {
    const c = reader.schema(name);
    if (!c) {
      diffs.push(`${name}: mirrored, but absent from the contract`);
      continue;
    }
    compared.push(name);
    diffs.push(...diffShapes(m, c, name));
  }

  // Endpoints: path parameters, query parameters and response bindings.
  for (const [endpoint, template] of Object.entries(binding.paths)) {
    const op = (doc.paths[template] as { get?: { parameters?: Parameter[]; responses?: Record<string, { content?: Record<string, { schema?: JsonSchema }> }> } } | undefined)?.get;
    if (!op) {
      diffs.push(`GET ${template}: path not in contract`);
      continue;
    }
    const pathLevel = ((doc.paths[template] as { parameters?: Parameter[] }).parameters ?? []) as Parameter[];
    const params = [...pathLevel, ...(op.parameters ?? [])];
    const at = `GET ${template}`;

    const placeholders = [...template.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!).sort();
    const pathParams = params.filter((p) => p.in === "path");
    const names = pathParams.map((p) => p.name).sort();
    if (placeholders.join(",") !== names.join(","))
      diffs.push(`${at}: path parameters — template {${placeholders.join("},{")}}, contract ${names.join(", ") || "none"}`);
    for (const p of pathParams) {
      if (p.required !== true) diffs.push(`${at} path ${p.name}: not required`);
      const s = p.schema ? reader.shape(p.schema, `${at} path ${p.name}`) : { t: "unknown" as const };
      if (s.t !== "string") diffs.push(`${at} path ${p.name}: type — mirror string, contract ${show(s)}`);
    }
    for (const p of params) if (p.in !== "path" && p.in !== "query") diffs.push(`${at}: ${p.in} parameter ${p.name} is not mirrored`);

    const queryDecl = binding.queries[endpoint];
    const q = queryDecl ? mirror.declaration(queryDecl) : undefined;
    if (!q || q.t !== "object") diffs.push(`${at}: query mirror ${queryDecl ?? "(none)"} missing from v1.ts`);
    else {
      const contractQuery: Shape = {
        t: "object",
        closed: true,
        props: Object.fromEntries(
          params.filter((p) => p.in === "query").map((p) => [p.name, { optional: p.required !== true, shape: p.schema ? reader.shape(p.schema, `${at} ?${p.name}`) : { t: "unknown" } }]),
        ),
      };
      diffs.push(...diffShapes(q, contractQuery, `${at} query (${queryDecl})`));
    }

    // Every response body is normalized like any other schema, so keywords beside a matching $ref are
    // judged by the same rules as in components; comparing the $ref string alone would ignore them.
    const responses = op.responses ?? {};
    const body = (status: string) => {
      const content = responses[status]?.content ?? {};
      for (const media of Object.keys(content)) if (media !== "application/json") diffs.push(`${at} ${status}: media type ${media} is not mirrored`);
      const s = content["application/json"]?.schema;
      return s ? reader.shape(s, `${at} ${status}`) : null;
    };
    const isRef = (s: Shape | null, name: string) => s?.t === "ref" && s.name === name;
    const root = binding.roots[endpoint]!;
    const ok = body("200");
    if (!isRef(ok, root)) diffs.push(`${at} 200: body — mirror ${root}, contract ${ok ? show(ok) : "none"}`);
    for (const status of Object.keys(responses).filter((s) => s !== "200")) {
      if (!/^[45]\d\d$/.test(status)) {
        diffs.push(`${at} ${status}: response is not mirrored`);
        continue;
      }
      if (!isRef(body(status), binding.error)) diffs.push(`${at} ${status}: body is not the ${binding.error} envelope`);
    }
  }

  diffs.push(...reader.problems);
  return { diffs: [...new Set(diffs)], compared, inScope: [...inScope].sort() };
}
