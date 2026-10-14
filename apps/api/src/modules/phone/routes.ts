import { and, eq, ilike, isNotNull, isNull, or, type SQL } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  PHONE_EMAIL_MAX_LENGTH,
  PHONE_EXTENSION_MAX_DIGITS,
  PHONE_EXTENSION_MIN_DIGITS,
  PHONE_LANGUAGES,
  PHONE_NAME_MAX_LENGTH,
  isValidExtension,
  isValidExternalNumber,
  normalizeExternalNumber,
  normalizeModules,
  type Permission,
  type PhoneRingGroup,
  type PhoneSystemDetailDto,
  type PhoneSystemDto,
  type PhoneTrunk,
  type PhoneUser,
  type PhoneUserCreatedDto,
  type PhoneUserDto,
  type PhoneUserListDto,
} from '@weblion/shared';
import type { AppContext } from '../../context';
import { platformScope, requireSession } from '../../auth/access';
import { organizations, phoneSystems } from '../../db/schema';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { parse } from '../../lib/validation';
import type { PhoneUserInput, PhoneUserPatch, RemotePhoneSystem } from '../../providers/types';
import { assignmentTarget } from '../hosting/service';
import { loadOrg } from '../orgs/routes';
import {
  PHONE_MODULE,
  isProtectedPhoneUser,
  loadPhoneSystem,
  phoneCapabilities,
  phoneChange,
  phoneSystemRow,
  phoneSystemRowsQuery,
  phoneSystemScope,
  refreshPhoneSystem,
  requirePhoneCapability,
  storePhoneSystem,
  toPhoneRingGroup,
  toPhoneSystemDto,
  toPhoneTrunk,
  toPhoneUserDto,
  type LoadedPhoneSystem,
} from './service';

const idParams = z.object({ id: z.uuid() });
const orgParams = z.object({ orgId: z.uuid() });
/** Ids of users and ring groups at the PBX; the adapter checks its own format. */
const providerId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const userParams = idParams.extend({ userId: providerId });
const groupParams = idParams.extend({ groupId: providerId });
const memberParams = groupParams.extend({ number: z.string().regex(/^[0-9]{2,10}$/) });

/** Empty strings from forms mean "none". */
const optional = <T extends z.ZodType<string>>(schema: T) =>
  z
    .union([z.literal(''), schema])
    .nullish()
    .transform((v) => (v === '' || v == null ? null : v));
const name = z.string().trim().min(1).max(PHONE_NAME_MAX_LENGTH);
const email = z.string().trim().toLowerCase().pipe(z.email().max(PHONE_EMAIL_MAX_LENGTH));
/** Mobile and outbound caller ID as typed by people: separators removed, "" means none. */
const externalNumber = z
  .string()
  .max(40)
  .transform((v) => normalizeExternalNumber(v))
  .refine((v) => v === null || isValidExternalNumber(v), 'digits, optionally with a leading +');
const language = optional(z.enum(PHONE_LANGUAGES));

const createUserBody = z.object({
  /** Empty or left out: the PBX picks the next free number. */
  number: z
    .union([
      z.literal(''),
      z
        .string()
        .trim()
        .regex(/^[0-9]{2,10}$/, '2 to 10 digits'),
    ])
    .nullish()
    .transform((v) => (v ? v : null)),
  firstName: name,
  lastName: optional(name),
  email,
  mobile: externalNumber.nullish(),
  outboundCallerId: externalNumber.nullish(),
  /** null: the PBX's default language. */
  language,
  sendWelcome: z.boolean().default(true),
});
/** Only keys present in the request count as changes (see PATCH .../users/:userId). */
const patchUserBody = z.object({
  firstName: name.optional(),
  lastName: optional(name),
  email: email.optional(),
  mobile: externalNumber.nullish(),
  outboundCallerId: externalNumber.nullish(),
  language,
});
const deleteBody = z.object({ confirm: z.string().trim().max(20) });
const memberBody = z.object({
  number: z
    .string()
    .trim()
    .regex(/^[0-9]{2,10}$/, '2 to 10 digits'),
});
const renameBody = z.object({ name: z.string().trim().min(1).max(80) });
const adminListQuery = z.object({
  q: z.string().max(100).optional(),
  assigned: z.enum(['true', 'false']).optional(),
  providerId: z.uuid().optional(),
  orgId: z.uuid().optional(),
});
const assignBody = z.object({ orgId: z.uuid().nullable(), enableModule: z.boolean().default(true) });

const PATCH_KEYS = ['firstName', 'lastName', 'email', 'mobile', 'outboundCallerId', 'language'] as const;

const PROTECTED_DELETE =
  'This user administers the phone system or is a system user. Only weblion staff can delete it.';
const PROTECTED_EMAIL =
  'This user administers the phone system or is a system user. Only weblion staff can change its e-mail address.';

const like = (q: string) => `%${q.replace(/[%_]/g, '')}%`;
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Live answers must not end up in browser or proxy caches. */
function noStore(reply: FastifyReply) {
  reply.header('cache-control', 'no-store');
}

/** "800 Zentrale" for audit entries. */
function groupLabel(group: PhoneRingGroup): string {
  return [group.number, group.name].filter(Boolean).join(' ');
}

/**
 * Telephony (module "phone"): phone systems of an organization, their users, ring groups and
 * trunks, and the admin list with assignment. Users, ring groups and trunks are read live at the
 * PBX; every change there is audited, failures included, and never carries a password or PIN.
 */
export async function phoneRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, access, audit } = ctx;

  async function system(req: FastifyRequest, permission?: Permission): Promise<LoadedPhoneSystem> {
    const { id } = parse(idParams, req.params);
    const loaded = await loadPhoneSystem(ctx, req, id);
    if (permission) await access.assert(req, permission, loaded.scope);
    return loaded;
  }

  async function systemDto(req: FastifyRequest, id: string): Promise<PhoneSystemDto> {
    const row = await phoneSystemRow(ctx, id);
    if (!row) throw notFound('Phone system');
    return toPhoneSystemDto(ctx, req, row);
  }

  /**
   * Users that administer the PBX or are no people (fax, AI agents), and users of unknown role,
   * are for weblion staff only.
   */
  async function assertMayTouchProtected(req: FastifyRequest, user: PhoneUser, message: string) {
    if (!isProtectedPhoneUser(user)) return;
    if (!(await access.can(req, 'platform:provider:write', platformScope))) throw forbidden(message);
  }

  // --- Customer: phone systems ---------------------------------------------------------

  app.get('/orgs/:orgId/phone-systems', async (req): Promise<PhoneSystemDto[]> => {
    const { orgId } = parse(orgParams, req.params);
    await loadOrg(ctx, req, orgId);
    const rows = await phoneSystemRowsQuery(ctx)
      .where(eq(phoneSystems.orgId, orgId))
      .orderBy(phoneSystems.name);
    const visible: PhoneSystemDto[] = [];
    for (const row of rows) {
      if (await access.can(req, 'phone:read', phoneSystemScope(row.system))) {
        visible.push(await toPhoneSystemDto(ctx, req, row));
      }
    }
    return visible;
  });

  /** Facts refreshed live when possible (the adapter caches them briefly), else the stored ones. */
  app.get('/phone-systems/:id', async (req): Promise<PhoneSystemDetailDto> => {
    const loaded = await system(req);
    let remote: RemotePhoneSystem | null = null;
    let liveError: string | null = null;
    if (loaded.adapter.getPhoneSystem) {
      try {
        remote = await loaded.adapter.getPhoneSystem(loaded.system.externalId);
      } catch (err) {
        req.log.warn({ err, phoneSystemId: loaded.system.id }, 'live phone system facts failed');
        liveError = errorMessage(err);
      }
    }
    // Only the sync marks a phone system unreachable; here the stored facts are shown.
    if (remote?.reachable === false) liveError = 'The phone system does not answer right now';
    else if (remote) loaded.system = await storePhoneSystem(db, loaded.system.id, remote, new Date());
    return { ...(await toPhoneSystemDto(ctx, req, loaded)), liveError };
  });

  /** The site label in the console. Changes nothing at the PBX. */
  app.patch('/phone-systems/:id', async (req): Promise<PhoneSystemDto> => {
    const loaded = await system(req, 'phone:write');
    const { name: next } = parse(renameBody, req.body);
    const before = loaded.system.name;
    if (next !== before) {
      await db.update(phoneSystems).set({ name: next }).where(eq(phoneSystems.id, loaded.system.id));
      await audit.record(req, {
        action: 'phone.system_rename',
        orgId: loaded.system.orgId,
        resourceType: 'phone_system',
        resourceId: loaded.system.id,
        details: { phoneSystem: before, before, after: next },
      });
    }
    return systemDto(req, loaded.system.id);
  });

  // --- Customer: users -----------------------------------------------------------------

  app.get('/phone-systems/:id/users', async (req): Promise<PhoneUserListDto> => {
    const loaded = await system(req);
    requirePhoneCapability(loaded.adapter, 'users', 'listPhoneUsers');
    const users = await loaded.adapter.listPhoneUsers!(loaded.system.externalId);
    const info = loaded.system.info;
    return {
      users: users.map(toPhoneUserDto),
      numberLength: info?.numberLength ?? null,
      usersCount: info?.users ?? null,
      maxUsers: info?.maxUsers ?? null,
    };
  });

  app.get('/phone-systems/:id/users/next-number', async (req, reply): Promise<{ number: string | null }> => {
    const loaded = await system(req, 'phone:write');
    requirePhoneCapability(loaded.adapter, 'nextNumber', 'nextPhoneNumber');
    const number = await loaded.adapter.nextPhoneNumber!(loaded.system.externalId);
    noStore(reply);
    return { number };
  });

  app.post('/phone-systems/:id/users', async (req, reply): Promise<PhoneUserCreatedDto> => {
    const loaded = await system(req, 'phone:write');
    const { adapter, system: row } = loaded;
    requirePhoneCapability(adapter, 'users', 'createPhoneUser');
    const body = parse(createUserBody, req.body);
    // The PBX's own answer stays authoritative; this catches typos with a clear field error.
    const numberLength = row.info?.numberLength ?? null;
    if (body.number !== null && !isValidExtension(body.number, numberLength)) {
      const digits =
        numberLength !== null && numberLength > 0
          ? `${numberLength}`
          : `${PHONE_EXTENSION_MIN_DIGITS} to ${PHONE_EXTENSION_MAX_DIGITS}`;
      throw badRequest('Validation failed', [
        { path: 'number', message: `The extension number must have ${digits} digits` },
      ]);
    }
    const input: PhoneUserInput = {
      ...(body.number !== null ? { number: body.number } : {}),
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
      mobile: body.mobile ?? null,
      outboundCallerId: body.outboundCallerId ?? null,
      language: body.language,
    };
    const user = await phoneChange(
      ctx,
      req,
      loaded,
      'user_create',
      {
        requestedNumber: body.number,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        mobile: input.mobile,
        outboundCallerId: input.outboundCallerId,
        language: input.language,
        sendWelcome: body.sendWelcome,
      },
      () => adapter.createPhoneUser!(row.externalId, input),
      (created) => ({ userId: created.id, number: created.number }),
    );

    // The PBX sends the welcome e-mail to the address given here. API tokens may do this on
    // creation (like a Nextcloud invitation); sending it again needs phone:credentials.
    let welcomeSent = false;
    let welcomeError: string | null = null;
    if (body.sendWelcome) {
      if (phoneCapabilities(adapter).includes('welcomeMail')) {
        try {
          await phoneChange(
            ctx,
            req,
            loaded,
            'user_welcome',
            { userId: user.id, number: user.number, email: user.email ?? input.email },
            () => adapter.sendPhoneWelcome!(row.externalId, user.id),
          );
          welcomeSent = true;
        } catch (err) {
          // The user exists; the failure is audited and the answer says so.
          welcomeError = errorMessage(err);
        }
      } else {
        welcomeError = 'This phone system cannot send welcome e-mails';
      }
    }
    await refreshPhoneSystem(ctx, loaded, req.log);
    reply.code(201);
    return { user: toPhoneUserDto(user), welcomeSent, welcomeError };
  });

  app.patch('/phone-systems/:id/users/:userId', async (req): Promise<PhoneUserDto> => {
    const loaded = await system(req, 'phone:write');
    const { adapter, system: row } = loaded;
    requirePhoneCapability(adapter, 'users', 'updatePhoneUser');
    const { userId } = parse(userParams, req.params);
    const body = parse(patchUserBody, req.body ?? {});
    // zod turns a missing key and null into the same value: only keys sent count.
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const current = await adapter.getPhoneUser!(row.externalId, userId);

    const wanted: PhoneUserPatch = {
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
      mobile: body.mobile ?? null,
      outboundCallerId: body.outboundCallerId ?? null,
      language: body.language,
    };
    const stored: PhoneUserPatch = {
      firstName: current.firstName ?? undefined,
      lastName: current.lastName || null,
      email: current.email?.toLowerCase(),
      mobile: normalizeExternalNumber(current.mobile),
      outboundCallerId: normalizeExternalNumber(current.outboundCallerId),
      language: current.language?.toLowerCase() || null,
    };
    const patch: PhoneUserPatch = {};
    for (const key of PATCH_KEYS) {
      if (!Object.hasOwn(raw, key) || wanted[key] === undefined || wanted[key] === stored[key]) continue;
      Object.assign(patch, { [key]: wanted[key] });
    }
    if (Object.keys(patch).length === 0) return toPhoneUserDto(current);

    // The PBX sends its access mails to this address: changing it hands out the extension,
    // like resending the welcome e-mail (interactive session, phone:credentials).
    if (patch.email !== undefined) {
      requireSession(req);
      await access.assert(req, 'phone:credentials', loaded.scope);
      await assertMayTouchProtected(req, current, PROTECTED_EMAIL);
    }
    const keys = Object.keys(patch) as (keyof PhoneUserPatch)[];
    const before = Object.fromEntries(keys.map((k) => [k, current[k] ?? null]));
    const updated = await phoneChange(
      ctx,
      req,
      loaded,
      'user_update',
      { userId: current.id, number: current.number, before, after: { ...patch } },
      () => adapter.updatePhoneUser!(row.externalId, current.id, patch),
    );
    return toPhoneUserDto(updated);
  });

  app.delete('/phone-systems/:id/users/:userId', async (req) => {
    const loaded = await system(req, 'phone:write');
    const { adapter, system: row } = loaded;
    requirePhoneCapability(adapter, 'users', 'deletePhoneUser');
    const { userId } = parse(userParams, req.params);
    const { confirm } = parse(deleteBody, req.body ?? {});
    const current = await adapter.getPhoneUser!(row.externalId, userId);
    await assertMayTouchProtected(req, current, PROTECTED_DELETE);
    if (confirm !== current.number) {
      throw badRequest('Validation failed', [
        { path: 'confirm', message: `Type the extension number ${current.number} to confirm` },
      ]);
    }
    await phoneChange(
      ctx,
      req,
      loaded,
      'user_delete',
      { userId: current.id, number: current.number, name: current.displayName, email: current.email },
      () => adapter.deletePhoneUser!(row.externalId, current.id),
    );
    await refreshPhoneSystem(ctx, loaded, req.log);
    return { ok: true };
  });

  app.post('/phone-systems/:id/users/:userId/welcome', async (req) => {
    const loaded = await system(req);
    // The mail carries the user's access: like a password, only in an interactive session.
    requireSession(req);
    await access.assert(req, 'phone:credentials', loaded.scope);
    const { adapter, system: row } = loaded;
    requirePhoneCapability(adapter, 'welcomeMail', 'sendPhoneWelcome');
    const { userId } = parse(userParams, req.params);
    // 404 first, so nothing is audited for a typo.
    const current = adapter.getPhoneUser ? await adapter.getPhoneUser(row.externalId, userId) : null;
    if (current && !current.email) throw badRequest('This user has no e-mail address');
    await phoneChange(
      ctx,
      req,
      loaded,
      'user_welcome',
      { userId, number: current?.number ?? null, email: current?.email ?? null },
      () => adapter.sendPhoneWelcome!(row.externalId, userId),
    );
    return { ok: true };
  });

  // --- Customer: ring groups and trunks ------------------------------------------------

  app.get('/phone-systems/:id/ring-groups', async (req): Promise<PhoneRingGroup[]> => {
    const loaded = await system(req);
    requirePhoneCapability(loaded.adapter, 'ringGroups', 'listPhoneRingGroups');
    const groups = await loaded.adapter.listPhoneRingGroups!(loaded.system.externalId);
    return groups.map(toPhoneRingGroup);
  });

  app.post('/phone-systems/:id/ring-groups/:groupId/members', async (req): Promise<PhoneRingGroup> => {
    const loaded = await system(req, 'phone:write');
    const { adapter, system: row } = loaded;
    requirePhoneCapability(adapter, 'ringGroupMembers', 'addPhoneRingGroupMember');
    const { groupId } = parse(groupParams, req.params);
    const { number } = parse(memberBody, req.body);
    // Ring groups may only ring users of this phone system, not queues, IVRs or trunks.
    if (adapter.listPhoneUsers) {
      const users = await adapter.listPhoneUsers(row.externalId);
      if (!users.some((u) => u.number === number)) {
        const message = `Extension ${number} is not a user of this phone system`;
        throw badRequest(message, [{ path: 'number', message }]);
      }
    }
    const group = await phoneChange(
      ctx,
      req,
      loaded,
      'ring_group_member_add',
      { groupId, member: number },
      () => adapter.addPhoneRingGroupMember!(row.externalId, groupId, number),
      (result) => ({ group: groupLabel(result) }),
    );
    return toPhoneRingGroup(group);
  });

  app.delete(
    '/phone-systems/:id/ring-groups/:groupId/members/:number',
    async (req): Promise<PhoneRingGroup> => {
      const loaded = await system(req, 'phone:write');
      const { adapter, system: row } = loaded;
      requirePhoneCapability(adapter, 'ringGroupMembers', 'removePhoneRingGroupMember');
      const { groupId, number } = parse(memberParams, req.params);
      const group = await phoneChange(
        ctx,
        req,
        loaded,
        'ring_group_member_remove',
        { groupId, member: number },
        () => adapter.removePhoneRingGroupMember!(row.externalId, groupId, number),
        (result) => ({ group: groupLabel(result) }),
      );
      return toPhoneRingGroup(group);
    },
  );

  app.get('/phone-systems/:id/trunks', async (req): Promise<PhoneTrunk[]> => {
    const loaded = await system(req);
    requirePhoneCapability(loaded.adapter, 'trunks', 'listPhoneTrunks');
    const trunks = await loaded.adapter.listPhoneTrunks!(loaded.system.externalId);
    return trunks.map(toPhoneTrunk);
  });

  // --- Admin: inventory and assignment -------------------------------------------------

  app.get('/admin/phone-systems', async (req): Promise<PhoneSystemDto[]> => {
    await access.assert(req, 'platform:provider:read', platformScope);
    const query = parse(adminListQuery, req.query);
    const filters: (SQL | undefined)[] = [
      query.assigned === 'true' ? isNotNull(phoneSystems.orgId) : undefined,
      query.assigned === 'false' ? isNull(phoneSystems.orgId) : undefined,
      query.providerId ? eq(phoneSystems.providerConnectionId, query.providerId) : undefined,
      query.orgId ? eq(phoneSystems.orgId, query.orgId) : undefined,
      query.q
        ? or(
            ilike(phoneSystems.name, like(query.q)),
            ilike(phoneSystems.fqdn, like(query.q)),
            ilike(phoneSystems.externalId, like(query.q)),
          )
        : undefined,
    ];
    const rows = await phoneSystemRowsQuery(ctx)
      .where(and(...filters))
      .orderBy(phoneSystems.name)
      .limit(1000);
    return Promise.all(rows.map((row) => toPhoneSystemDto(ctx, req, row)));
  });

  /**
   * Assigns a phone system to an organization (null: unassigns it) and switches the module on
   * for it. Phone systems are not billable resources yet, so no service can block the move.
   */
  app.post('/admin/phone-systems/:id/assign', async (req): Promise<PhoneSystemDto> => {
    await access.assert(req, 'platform:server:assign', platformScope);
    const { id } = parse(idParams, req.params);
    const body = parse(assignBody, req.body);
    const current = await db.query.phoneSystems.findFirst({ where: eq(phoneSystems.id, id) });
    if (!current) throw notFound('Phone system');
    const target = body.orgId
      ? await assignmentTarget(db, body.orgId, PHONE_MODULE, body.enableModule)
      : null;
    const moduleEnabled = await db.transaction(async (tx) => {
      let enabled = false;
      if (target?.enable) {
        // Read again under the row lock: a parallel module change must not be undone.
        const [org] = await tx
          .select({ modules: organizations.modules })
          .from(organizations)
          .where(eq(organizations.id, target.org.id))
          .for('update');
        if (org && !org.modules.includes(PHONE_MODULE)) {
          await tx
            .update(organizations)
            .set({ modules: normalizeModules([...org.modules, PHONE_MODULE]) })
            .where(eq(organizations.id, target.org.id));
          enabled = true;
        }
      }
      await tx.update(phoneSystems).set({ orgId: body.orgId }).where(eq(phoneSystems.id, id));
      return enabled;
    });
    await audit.record(req, {
      action: body.orgId ? 'phone.system_assign' : 'phone.system_unassign',
      orgId: body.orgId ?? current.orgId,
      resourceType: 'phone_system',
      resourceId: id,
      details: {
        phoneSystem: current.name,
        name: current.name,
        orgId: body.orgId,
        previousOrgId: current.orgId,
        moduleEnabled: moduleEnabled ? PHONE_MODULE : null,
      },
    });
    return systemDto(req, id);
  });
}
