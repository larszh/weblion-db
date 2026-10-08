import { createContext, useContext, type ReactNode } from 'react';
import type { ModuleKey, OrgDto, Permission } from '@weblion/shared';

interface OrgContextValue {
  org: OrgDto;
  /** Organization level check, mirrors the API decision for resource "org". */
  can: (permission: Permission) => boolean;
  /** True when the service module is activated for this organization. */
  hasModule: (module: ModuleKey) => boolean;
  base: string;
}

const OrgContext = createContext<OrgContextValue | null>(null);

export function OrgProvider({ org, children }: { org: OrgDto; children: ReactNode }) {
  const value: OrgContextValue = {
    org,
    can: (p) => org.permissions.includes(p),
    hasModule: (m) => org.modules.includes(m),
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
