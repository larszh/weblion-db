import { eq } from 'drizzle-orm';
import { allowedActions, PLATFORM_PERMISSIONS, type MeDto, type UserDto } from '@weblion/shared';
import type { Database } from '../db/client';
import { memberships, organizations, type User } from '../db/schema';
import type { AuthState } from '../auth/types';

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    platformRole: user.platformRole ?? null,
    mfaEnabled: user.totpEnabled,
    locale: user.locale,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: iso(user.lastLoginAt),
  };
}

export async function buildMe(db: Database, auth: AuthState): Promise<MeDto> {
  if (auth.mfaPending) {
    return { user: toUserDto(auth.user), memberships: [], platformPermissions: [], mfaPending: true };
  }
  const rows = await db
    .select({ membership: memberships, org: organizations })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(eq(memberships.userId, auth.user.id))
    .orderBy(organizations.name);

  const tokenOrg = auth.token?.orgId;
  return {
    user: toUserDto(auth.user),
    memberships: rows
      .filter((r) => !tokenOrg || r.org.id === tokenOrg)
      .map((r) => ({
        orgId: r.org.id,
        orgName: r.org.name,
        orgSlug: r.org.slug,
        orgKind: r.org.kind,
        role: r.membership.role,
      })),
    platformPermissions:
      auth.user.platformRole && !auth.token
        ? allowedActions({ platformRole: auth.user.platformRole }, PLATFORM_PERMISSIONS, { path: 'platform' })
        : [],
  };
}
