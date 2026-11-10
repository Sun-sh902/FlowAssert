"""A validator for the part of JSON Schema draft 2020-12 that the report schemas use (docs/schema/). Standard library
only, for the tests and the conformance runner; the checker itself never validates against a schema.

    errors = validate(schema, instance)             a list of "PATH: what is wrong", empty when valid
    names = undeclared(schema, instance)            members of the instance that no keyword of the schema names

Supported keywords: type, const, enum, minimum, pattern, required, properties, patternProperties,
additionalProperties, dependentRequired, items, minItems, maxItems, allOf, anyOf, oneOf, not, if/then/else, and $ref
to "#/$defs/NAME". $schema, $id, $defs, title, description and $comment are read as annotations. Any other keyword
raises SchemaError, so a schema cannot rely on something this validator would silently ignore. A schema may also be
true or false.

A pattern is an ECMAScript regular expression, as JSON Schema says. The patterns the schemas use are written in the
syntax ECMAScript and Python share, with two differences this module removes: "$" matches only at the very end, and
"." matches no line terminator. ui/src/test/offline/json-schema.ts is the same validator in TypeScript; both run the
cases of json_schema_cases.json.
"""
import re

ANNOTATIONS = {"$schema", "$id", "$defs", "title", "description", "$comment"}
KEYWORDS = {"type", "const", "enum", "minimum", "pattern", "required", "properties", "patternProperties",
            "additionalProperties", "dependentRequired", "items", "minItems", "maxItems", "allOf", "anyOf", "oneOf",
            "not", "if", "then", "else", "$ref"}
TYPES = ("null", "boolean", "integer", "number", "string", "array", "object")


class SchemaError(ValueError):
    """The schema uses something this validator does not support, or is not a schema."""


def _is_type(value, name):
    if name == "null":
        return value is None
    if name == "boolean":
        return isinstance(value, bool)
    if name == "integer":
        return (isinstance(value, int) and not isinstance(value, bool)) or (isinstance(value, float)
                                                                            and value.is_integer())
    if name == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if name == "string":
        return isinstance(value, str)
    if name == "array":
        return isinstance(value, list)
    if name == "object":
        return isinstance(value, dict)
    raise SchemaError(f"unknown type {name!r}")


def json_equal(a, b):
    """Equality as JSON has it: true is not 1, and 1 is 1.0."""
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a == b
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(json_equal(x, y) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(json_equal(a[k], b[k]) for k in a)
    return type(a) is type(b) and a == b


_PATTERNS = {}


def _pattern(text):
    """An ECMAScript pattern as a Python one: "$" only at the very end, "." without line terminators."""
    compiled = _PATTERNS.get(text)
    if compiled is None:
        out, i, in_class = [], 0, False
        while i < len(text):
            c = text[i]
            if c == "\\":
                out.append(text[i:i + 2])
                i += 2
                continue
            if in_class:
                in_class = c != "]"
                out.append(c)
            elif c == "[":
                in_class = True
                out.append(c)
            elif c == "$":
                out.append(r"\Z")
            elif c == ".":
                out.append("[^\\n\\r  ]")
            else:
                out.append(c)
            i += 1
        try:
            compiled = _PATTERNS[text] = re.compile("".join(out))
        except re.error as e:
            raise SchemaError(f"pattern {text!r} does not compile ({e})")
    return compiled


def _show(value):
    text = repr(value)
    return text if len(text) <= 60 else text[:57] + "..."


class _Run:
    def __init__(self, root):
        self.root = root
        self.seen = set()  # (path, member) that a properties keyword named

    def resolve(self, pointer):
        if not pointer.startswith("#/$defs/"):
            raise SchemaError(f"$ref {pointer!r} is not #/$defs/NAME")
        name = pointer[len("#/$defs/"):]
        definitions = self.root.get("$defs", {}) if isinstance(self.root, dict) else {}
        if name not in definitions:
            raise SchemaError(f"$ref {pointer!r} names no definition")
        return definitions[name]

    def check(self, schema, value, path):
        """The errors of `value` against `schema`."""
        if schema is True:
            return []
        if schema is False:
            return [f"{path}: nothing is allowed here"]
        if not isinstance(schema, dict):
            raise SchemaError(f"a schema must be an object or a boolean, not {_show(schema)}")
        unknown = set(schema) - KEYWORDS - ANNOTATIONS
        if unknown:
            raise SchemaError(f"unsupported keyword {', '.join(sorted(unknown))}")
        errors = []
        if "$ref" in schema:
            errors += self.check(self.resolve(schema["$ref"]), value, path)
        if "type" in schema:
            names = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
            if not any(_is_type(value, name) for name in names):
                errors.append(f"{path}: must be {' or '.join(names)}, not {_show(value)}")
        if "const" in schema and not json_equal(value, schema["const"]):
            errors.append(f"{path}: must be {_show(schema['const'])}, not {_show(value)}")
        if "enum" in schema and not any(json_equal(value, item) for item in schema["enum"]):
            errors.append(f"{path}: must be one of {_show(schema['enum'])}, not {_show(value)}")
        if "minimum" in schema and _is_type(value, "number") and value < schema["minimum"]:
            errors.append(f"{path}: must be at least {schema['minimum']}, not {_show(value)}")
        if "pattern" in schema and isinstance(value, str) and not _pattern(schema["pattern"]).search(value):
            errors.append(f"{path}: {_show(value)} does not match {schema['pattern']}")
        if isinstance(value, dict):
            errors += self._object(schema, value, path)
        if isinstance(value, list):
            if "minItems" in schema and len(value) < schema["minItems"]:
                errors.append(f"{path}: must have at least {schema['minItems']} items, not {len(value)}")
            if "maxItems" in schema and len(value) > schema["maxItems"]:
                errors.append(f"{path}: must have at most {schema['maxItems']} items, not {len(value)}")
            if "items" in schema:
                for i, item in enumerate(value):
                    errors += self.check(schema["items"], item, f"{path}[{i}]")
        for sub in schema.get("allOf", []):
            errors += self.check(sub, value, path)
        if "anyOf" in schema:
            results = [self.check(sub, value, path) for sub in schema["anyOf"]]
            if all(results):
                errors.append(f"{path}: matches none of the alternatives ({'; '.join(r[0] for r in results)})")
        if "oneOf" in schema:
            results = [self.check(sub, value, path) for sub in schema["oneOf"]]
            valid = sum(not r for r in results)
            if valid == 0:
                errors.append(f"{path}: matches none of the alternatives ({'; '.join(r[0] for r in results)})")
            elif valid > 1:
                errors.append(f"{path}: matches {valid} alternatives, and exactly one is allowed")
        if "not" in schema and not self.check(schema["not"], value, path):
            errors.append(f"{path}: matches what is not allowed here")
        if "if" in schema:
            branch = "then" if not self.check(schema["if"], value, path) else "else"
            if branch in schema:
                errors += self.check(schema[branch], value, path)
        return errors

    def _object(self, schema, value, path):
        errors = []
        for name in schema.get("required", []):
            if name not in value:
                errors.append(f"{path}: {name} is missing")
        for name, needed in schema.get("dependentRequired", {}).items():
            if name in value:
                for other in needed:
                    if other not in value:
                        errors.append(f"{path}: {other} is missing, and {name} needs it")
        properties = schema.get("properties", {})
        patterns = schema.get("patternProperties", {})
        for name, item in value.items():
            where = f"{path}.{name}" if path else name
            matched = False
            if name in properties:
                matched = True
                self.seen.add((path, name))
                errors += self.check(properties[name], item, where)
            for pattern, sub in patterns.items():
                if _pattern(pattern).search(name):
                    matched = True
                    self.seen.add((path, name))
                    errors += self.check(sub, item, where)
            if not matched and "additionalProperties" in schema:
                extra = schema["additionalProperties"]
                if extra is not False:
                    self.seen.add((path, name))
                errors += [f"{path}: {name} is not allowed"] if extra is False else self.check(extra, item, where)
        return errors


def validate(schema, instance):
    """The errors of `instance` against `schema`, each "PATH: what is wrong"; empty when it is valid."""
    return _Run(schema).check(schema, instance, "")


def undeclared(schema, instance):
    """The members of `instance`, as paths, that no properties, patternProperties or additionalProperties keyword
    met during validation names. An open schema allows them; a test uses this to see that it describes them all."""
    run = _Run(schema)
    run.check(schema, instance, "")
    missing = []

    def walk(value, path):
        if isinstance(value, dict):
            for name, item in value.items():
                where = f"{path}.{name}" if path else name
                if (path, name) not in run.seen:
                    missing.append(where)
                walk(item, where)
        elif isinstance(value, list):
            for i, item in enumerate(value):
                walk(item, f"{path}[{i}]")

    walk(instance, "")
    return missing
