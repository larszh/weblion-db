import { createContext, useContext, type ReactNode } from 'react';
import type { Capability, Permission, ServerDto } from '@weblion/shared';

interface ServerContextValue {
  server: ServerDto;
  can: (permission: Permission) => boolean;
  has: (capability: Capability) => boolean;
  /** Both: provider supports it and the user may use it. */
  allowed: (capability: Capability, permission: Permission) => boolean;
}

const ServerContext = createContext<ServerContextValue | null>(null);

export function ServerProvider({ server, children }: { server: ServerDto; children: ReactNode }) {
  const can = (p: Permission) => server.permissions.includes(p);
  const has = (c: Capability) => server.capabilities.includes(c);
  return (
    <ServerContext.Provider value={{ server, can, has, allowed: (c, p) => has(c) && can(p) }}>
      {children}
    </ServerContext.Provider>
  );
}

export function useServerContext(): ServerContextValue {
  const ctx = useContext(ServerContext);
  if (!ctx) throw new Error('useServerContext must be used inside ServerProvider');
  return ctx;
}
