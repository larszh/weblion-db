import { z } from 'zod';

/**
 * zod 4 schemas as JSON Schema for strict tools and structured outputs (ai 6.5). Both accept only a subset of
 * JSON Schema: every object closed and fully required, no length or number limits. The dropped constraints
 * stay in the zod schema, which validates every tool input and every answer before it is used.
 */

type Json = Record<string, unknown>;

/** Keywords that pass unchanged; everything else is dropped (after the checks that throw). */
const KEEP = new Set([
  'type',
  'enum',
  'const',
  'anyOf',
  'allOf',
  '$ref',
  '$defs',
  'items',
  'properties',
  'required',
  'additionalProperties',
  'description',
  'format',
  'minItems',
]);

const FORMATS = new Set([
  'date-time',
  'time',
  'date',
  'duration',
  'email',
  'hostname',
  'uri',
  'ipv4',
  'ipv6',
  'uuid',
]);

function isObject(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Every $ref in a subtree. */
function refsIn(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) for (const item of node) refsIn(item, out);
  else if (isObject(node)) {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') out.push(value);
      else refsIn(value, out);
    }
  }
  return out;
}

/** Recursion is not supported by structured outputs: a reference to the root or a definition reaching itself. */
function assertNoRecursion(root: Json): void {
  const defs = isObject(root.$defs) ? root.$defs : {};
  const defName = (ref: string) => (ref.startsWith('#/$defs/') ? ref.slice('#/$defs/'.length) : null);
  const reaches = (name: string, target: string, seen: Set<string>): boolean => {
    if (seen.has(name)) return false;
    seen.add(name);
    for (const ref of refsIn(defs[name])) {
      if (ref === '#') return true;
      const next = defName(ref);
      if (next === target || (next && reaches(next, target, seen))) return true;
    }
    return false;
  };
  const { $defs: _defs, ...body } = root;
  if (refsIn(body).includes('#')) throw new Error('toStrictJsonSchema: recursive schemas are not supported');
  for (const name of Object.keys(defs)) {
    if (refsIn(defs[name]).includes('#') || reaches(name, name, new Set())) {
      throw new Error('toStrictJsonSchema: recursive schemas are not supported');
    }
  }
}

function strictify(node: unknown, path: string): unknown {
  if (Array.isArray(node)) return node.map((item, i) => strictify(item, `${path}/${i}`));
  if (!isObject(node)) return node;

  if ('prefixItems' in node) throw new Error(`toStrictJsonSchema: tuples are not supported (${path})`);
  if (isObject(node.additionalProperties) || node.additionalProperties === true || 'propertyNames' in node) {
    throw new Error(`toStrictJsonSchema: records are not supported (${path})`);
  }

  // type: ['string', 'null'] (zod's nullable primitives) becomes anyOf, the form structured outputs document.
  if (Array.isArray(node.type) && node.type.length > 1) {
    const { type, ...rest } = node;
    const branches = (type as unknown[]).map((t) => (t === 'null' ? { type: 'null' } : { ...rest, type: t }));
    return strictify({ anyOf: branches }, path);
  }
  // Discriminated unions come out as oneOf; their branches are disjoint, so anyOf means the same.
  if (Array.isArray(node.oneOf)) {
    const { oneOf, ...rest } = node;
    return strictify({ ...rest, anyOf: oneOf }, path);
  }

  const out: Json = {};
  for (const [key, value] of Object.entries(node)) {
    if (!KEEP.has(key)) continue;
    if (key === 'format' && !(typeof value === 'string' && FORMATS.has(value))) continue;
    if (key === 'minItems' && !(typeof value === 'number' && value <= 1)) continue;
    if (key === 'properties' && isObject(value)) {
      out.properties = Object.fromEntries(
        Object.entries(value).map(([name, schema]) => [name, strictify(schema, `${path}/${name}`)]),
      );
    } else if (key === '$defs' && isObject(value)) {
      out.$defs = Object.fromEntries(
        Object.entries(value).map(([name, schema]) => [name, strictify(schema, `${path}/$defs/${name}`)]),
      );
    } else if (key === 'required' || key === 'enum' || key === 'const' || key === 'additionalProperties') {
      out[key] = value;
    } else {
      out[key] = strictify(value, `${path}/${key}`);
    }
  }

  if (out.type === 'object' || isObject(out.properties)) {
    const properties = isObject(out.properties) ? out.properties : {};
    const required = new Set(Array.isArray(node.required) ? (node.required as string[]) : []);
    const optional = Object.keys(properties).filter((name) => !required.has(name));
    if (optional.length > 0) {
      // AI schemas use .nullable() for absent values, so the model always sends every key.
      throw new Error(
        `toStrictJsonSchema: optional properties are not supported (${path}: ${optional.join(', ')})`,
      );
    }
    out.properties = properties;
    out.required = Object.keys(properties);
    out.additionalProperties = false;
  }
  return out;
}

/** zod 4 schema -> JSON Schema accepted by strict tools and structured outputs. Throws on what they reject. */
export function toStrictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'throw' }) as Json;
  assertNoRecursion(raw);
  return strictify(raw, '#') as Record<string, unknown>;
}
