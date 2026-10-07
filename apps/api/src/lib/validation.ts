import { z } from 'zod';
import { validateStatements, type PolicyStatement } from '@weblion/shared';
import { badRequest } from './errors';

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest(
      'Validation failed',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}

export const uuidParam = z.object({ id: z.uuid() });

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
});

export const statementSchema = z.object({
  sid: z.string().max(100).optional(),
  effect: z.enum(['allow', 'deny']),
  actions: z.array(z.string().min(1).max(100)).min(1).max(100),
  resources: z.array(z.string().min(1).max(200)).max(100).optional(),
  conditions: z
    .object({
      labels: z.record(z.string().max(63), z.string().max(255)).optional(),
    })
    .optional(),
});

export const statementsSchema = z.array(statementSchema).min(1).max(50);

/** Schema validation plus the semantic checks from the shared policy module. */
export function parseStatements(data: unknown): PolicyStatement[] {
  const statements = parse(statementsSchema, data) as PolicyStatement[];
  const issues = validateStatements(statements);
  if (issues.length > 0) throw badRequest('Invalid policy', issues);
  return statements;
}

export const labelsSchema = z
  .record(
    z.string().regex(/^[a-z0-9]([a-z0-9._/-]{0,61}[a-z0-9])?$/i, 'invalid label key'),
    z.string().max(63),
  )
  .refine((labels) => Object.keys(labels).length <= 32, 'at most 32 labels');

export const passwordSchema = z.string().min(10, 'at least 10 characters').max(200);

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}
