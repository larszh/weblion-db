import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toStrictJsonSchema } from './schema';

describe('toStrictJsonSchema', () => {
  it('closes every object and requires every property, nested ones too', () => {
    const schema = toStrictJsonSchema(
      z.object({
        a: z.string(),
        inner: z.object({ b: z.number(), list: z.array(z.object({ c: z.boolean() })) }),
      }),
    );
    expect(schema).toEqual({
      type: 'object',
      properties: {
        a: { type: 'string' },
        inner: {
          type: 'object',
          properties: {
            b: { type: 'number' },
            list: {
              type: 'array',
              items: {
                type: 'object',
                properties: { c: { type: 'boolean' } },
                required: ['c'],
                additionalProperties: false,
              },
            },
          },
          required: ['b', 'list'],
          additionalProperties: false,
        },
      },
      required: ['a', 'inner'],
      additionalProperties: false,
    });
    expect(schema).not.toHaveProperty('$schema');
  });

  it('throws on optional properties', () => {
    expect(() => toStrictJsonSchema(z.object({ a: z.string().optional() }))).toThrow(/optional/);
    expect(() => toStrictJsonSchema(z.object({ o: z.object({ b: z.number().optional() }) }))).toThrow(
      /optional/,
    );
  });

  it('turns nullable values into anyOf with null', () => {
    const schema = toStrictJsonSchema(
      z.object({ s: z.string().nullable(), n: z.number().nullable(), e: z.enum(['x', 'y']).nullable() }),
    ) as { properties: Record<string, unknown> };
    expect(schema.properties.s).toEqual({ anyOf: [{ type: 'string' }, { type: 'null' }] });
    expect(schema.properties.n).toEqual({ anyOf: [{ type: 'number' }, { type: 'null' }] });
    expect(schema.properties.e).toEqual({ anyOf: [{ type: 'string', enum: ['x', 'y'] }, { type: 'null' }] });
  });

  it('keeps supported formats and drops patterns, lengths and number limits', () => {
    const schema = toStrictJsonSchema(
      z.object({
        id: z.uuid(),
        mail: z.email(),
        url: z.url(),
        at: z.iso.datetime(),
        name: z
          .string()
          .min(1)
          .max(80)
          .regex(/^[a-z]+$/),
        count: z.number().int().min(0).max(5),
        ratio: z.number().gt(0).lt(1).multipleOf(0.5),
        tags: z.array(z.string()).min(1).max(5),
        many: z.array(z.string()).min(2),
        id2: z.cuid(),
      }),
    ) as { properties: Record<string, Record<string, unknown>> };
    expect(schema.properties.id).toEqual({ type: 'string', format: 'uuid' });
    expect(schema.properties.mail).toEqual({ type: 'string', format: 'email' });
    expect(schema.properties.url).toEqual({ type: 'string', format: 'uri' });
    expect(schema.properties.at).toEqual({ type: 'string', format: 'date-time' });
    expect(schema.properties.name).toEqual({ type: 'string' });
    expect(schema.properties.count).toEqual({ type: 'integer' });
    expect(schema.properties.ratio).toEqual({ type: 'number' });
    expect(schema.properties.tags).toEqual({ type: 'array', items: { type: 'string' }, minItems: 1 });
    expect(schema.properties.many).toEqual({ type: 'array', items: { type: 'string' } });
    expect(schema.properties.id2).toEqual({ type: 'string' });
  });

  it('keeps enums, consts and descriptions; discriminated unions become anyOf', () => {
    const schema = toStrictJsonSchema(
      z.object({
        severity: z.enum(['info', 'warning', 'error']).describe('How bad it is'),
        kind: z.literal('a'),
        choice: z.discriminatedUnion('t', [
          z.object({ t: z.literal('a') }),
          z.object({ t: z.literal('b'), v: z.string() }),
        ]),
      }),
    ) as { properties: Record<string, Record<string, unknown>> };
    expect(schema.properties.severity).toEqual({
      type: 'string',
      enum: ['info', 'warning', 'error'],
      description: 'How bad it is',
    });
    expect(schema.properties.kind).toEqual({ type: 'string', const: 'a' });
    expect(schema.properties.choice).not.toHaveProperty('oneOf');
    expect((schema.properties.choice!.anyOf as unknown[]).length).toBe(2);
  });

  it('throws on records, tuples and recursion', () => {
    expect(() => toStrictJsonSchema(z.object({ m: z.record(z.string(), z.number()) }))).toThrow(/records/);
    expect(() => toStrictJsonSchema(z.object({ t: z.tuple([z.string(), z.number()]) }))).toThrow(/tuples/);
    const Node: z.ZodType = z.object({
      name: z.string(),
      get children() {
        return z.array(Node);
      },
    });
    expect(() => toStrictJsonSchema(Node)).toThrow(/recursive/);
  });

  it('converts the translation batch output (i18n 12.4)', () => {
    const output = z.object({ items: z.array(z.object({ id: z.string(), text: z.string() })) });
    expect(toStrictJsonSchema(output)).toEqual({
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, text: { type: 'string' } },
            required: ['id', 'text'],
            additionalProperties: false,
          },
        },
      },
      required: ['items'],
      additionalProperties: false,
    });
  });
});
