import { createContext, useContext, type ReactNode } from 'react';
import type { OrgDto, Permission } from '@weblion/shared';

interface OrgContextValue {
  org: OrgDto;
  /** Organization level check, mirrors the API decision for resource "org". */
  can: (permission: Permission) => boolean;
  base: string;
}

const OrgContext = createContext<OrgContextValue | null>(null);

export function OrgProvider({ org, children }: { org: OrgDto; children: ReactNode }) {
  const value: OrgContextValue = {
    org,
    can: (p) => org.permissions.includes(p),
    base: `/o/${org.slug}`,
  };
  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error('useOrg must be used inside an organization route');
  return ctx;
}

export function useOptionalOrg(): OrgContextValue | null {
  return useContext(OrgContext);
}
