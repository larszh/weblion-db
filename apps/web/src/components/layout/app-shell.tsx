import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Building2,
  Check,
  ChevronsUpDown,
  Cloud,
  FolderKanban,
  Gauge,
  KeyRound,
  LayoutDashboard,
  Languages,
  LogOut,
  Menu as MenuIcon,
  Monitor,
  Moon,
  Network,
  ScrollText,
  Server,
  Settings,
  ShieldCheck,
  Sun,
  Terminal,
  UserCircle,
  Users,
  X,
} from 'lucide-react';
import type { MeDto } from '@weblion/shared';
import { cn } from '@/lib/cn';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useOptionalOrg } from '@/lib/org-context';
import { useTheme } from '@/lib/theme';
import { useMe } from '@/lib/queries';
import type { TranslationKey } from '@/i18n/de';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/components/ui/menu';

interface NavItem {
  to: string;
  label: TranslationKey;
  icon: ReactNode;
  end?: boolean;
  show?: boolean;
}

function NavSection({
  title,
  items,
  onNavigate,
}: {
  title?: string;
  items: NavItem[];
  onNavigate?: () => void;
}) {
  const visible = items.filter((i) => i.show !== false);
  const { t } = useI18n();
  if (visible.length === 0) return null;
  return (
    <div className="space-y-0.5">
      {title && (
        <div className="px-3 pt-4 pb-1.5 text-[11px] font-semibold tracking-wider text-subtle uppercase">
          {title}
        </div>
      )}
      {visible.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors [&>svg]:size-[18px]',
              isActive
                ? 'bg-sidebar-active text-primary-text'
                : 'text-muted hover:bg-surface-3 hover:text-text',
            )
          }
        >
          {item.icon}
          {t(item.label)}
        </NavLink>
      ))}
    </div>
  );
}

function OrgSwitcher({ me }: { me: MeDto }) {
  const { t } = useI18n();
  const orgCtx = useOptionalOrg();
  const navigate = useNavigate();
  const current = orgCtx?.org;
  return (
    <Menu
      align="start"
      className="w-[232px]"
      trigger={
        <button className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-surface px-2.5 py-2 text-left hover:bg-surface-3">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary-soft text-xs font-bold text-primary-text">
            {(current?.name ?? 'W').slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-text">
              {current?.name ?? t('nav.chooseOrg')}
            </span>
            <span className="block truncate text-xs text-muted">
              {current
                ? current.role
                  ? t(`role.${current.role}` as TranslationKey)
                  : t('nav.staffAccess')
                : '—'}
            </span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-subtle" />
        </button>
      }
    >
      <MenuLabel>{t('nav.organizations')}</MenuLabel>
      {me.memberships.map((m) => (
        <MenuItem
          key={m.orgId}
          icon={m.orgId === current?.id ? <Check /> : <Building2 />}
          onSelect={() => navigate(`/o/${m.orgSlug}`)}
          hint={t(`role.${m.role}` as TranslationKey)}
        >
          {m.orgName}
        </MenuItem>
      ))}
      {me.platformPermissions.includes('platform:org:read') && (
        <>
          <MenuSeparator />
          <MenuItem icon={<Building2 />} onSelect={() => navigate('/admin/customers')}>
            {t('nav.allCustomers')}
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

function UserMenu({ me }: { me: MeDto }) {
  const { t, locale, setLocale } = useI18n();
  const { preference, setTheme } = useTheme();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const logout = async () => {
    await api.post('/auth/logout').catch(() => null);
    qc.clear();
    navigate('/login');
  };
  return (
    <Menu
      align="start"
      className="w-[232px]"
      trigger={
        <button className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-surface-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-teal to-brand-blue text-xs font-semibold text-white">
            {me.user.name
              .split(' ')
              .map((p) => p[0])
              .slice(0, 2)
              .join('')
              .toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-text">{me.user.name}</span>
            <span className="block truncate text-xs text-muted">{me.user.email}</span>
          </span>
        </button>
      }
    >
      <MenuItem icon={<UserCircle />} onSelect={() => navigate('/account')}>
        {t('nav.account')}
      </MenuItem>
      <MenuSeparator />
      <MenuLabel>{t('nav.theme')}</MenuLabel>
      {(
        [
          ['light', <Sun key="l" />, 'theme.light'],
          ['dark', <Moon key="d" />, 'theme.dark'],
          ['system', <Monitor key="s" />, 'theme.system'],
        ] as const
      ).map(([value, icon, label]) => (
        <MenuItem key={value} icon={preference === value ? <Check /> : icon} onSelect={() => setTheme(value)}>
          {t(label)}
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem icon={<Languages />} onSelect={() => setLocale(locale === 'de' ? 'en' : 'de')}>
        {locale === 'de' ? 'English' : 'Deutsch'}
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<LogOut />} onSelect={() => void logout()}>
        {t('nav.logout')}
      </MenuItem>
    </Menu>
  );
}

function Sidebar({ me, onNavigate }: { me: MeDto; onNavigate?: () => void }) {
  const { t } = useI18n();
  const orgCtx = useOptionalOrg();
  const location = useLocation();
  const inAdmin = location.pathname.startsWith('/admin');
  const p = me.platformPermissions;
  const base = orgCtx?.base;

  return (
    <div className="flex h-full flex-col">
      <Link to="/" className="flex h-16 shrink-0 items-center px-5" onClick={onNavigate}>
        <img src="/logo-horizontal.png" alt="weblion.one" className="h-7 w-auto" />
      </Link>
      <div className="px-3 pb-2">
        <OrgSwitcher me={me} />
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {orgCtx && base && !inAdmin && (
          <>
            <NavSection
              onNavigate={onNavigate}
              items={[
                { to: base, label: 'nav.overview', icon: <LayoutDashboard />, end: true },
                { to: `${base}/servers`, label: 'nav.servers', icon: <Server /> },
                { to: `${base}/projects`, label: 'nav.projects', icon: <FolderKanban /> },
              ]}
            />
            <NavSection
              title={t('nav.section.access')}
              onNavigate={onNavigate}
              items={[
                {
                  to: `${base}/members`,
                  label: 'nav.members',
                  icon: <Users />,
                  show: orgCtx.can('member:read'),
                },
                {
                  to: `${base}/policies`,
                  label: 'nav.policies',
                  icon: <ShieldCheck />,
                  show: orgCtx.can('policy:read'),
                },
                {
                  to: `${base}/tokens`,
                  label: 'nav.tokens',
                  icon: <KeyRound />,
                  show: orgCtx.can('apitoken:read'),
                },
                {
                  to: `${base}/audit`,
                  label: 'nav.audit',
                  icon: <ScrollText />,
                  show: orgCtx.can('audit:read'),
                },
                {
                  to: `${base}/settings`,
                  label: 'nav.settings',
                  icon: <Settings />,
                  show: orgCtx.can('org:read'),
                },
              ]}
            />
          </>
        )}
        {p.includes('platform:access') && (
          <NavSection
            title={t('nav.section.admin')}
            onNavigate={onNavigate}
            items={[
              { to: '/admin', label: 'nav.admin.overview', icon: <Gauge />, end: true },
              {
                to: '/admin/customers',
                label: 'nav.admin.customers',
                icon: <Building2 />,
                show: p.includes('platform:org:read'),
              },
              {
                to: '/admin/users',
                label: 'nav.admin.users',
                icon: <Users />,
                show: p.includes('platform:user:read'),
              },
              { to: '/admin/servers', label: 'nav.admin.inventory', icon: <Server /> },
              {
                to: '/admin/providers',
                label: 'nav.admin.providers',
                icon: <Cloud />,
                show: p.includes('platform:provider:read'),
              },
              {
                to: '/admin/explorer',
                label: 'nav.admin.explorer',
                icon: <Terminal />,
                show: p.includes('platform:explorer'),
              },
              {
                to: '/admin/audit',
                label: 'nav.admin.audit',
                icon: <Activity />,
                show: p.includes('platform:audit:read'),
              },
            ]}
          />
        )}
        {!inAdmin && !orgCtx && me.memberships[0] && (
          <NavSection
            onNavigate={onNavigate}
            items={[{ to: `/o/${me.memberships[0].orgSlug}`, label: 'nav.backToConsole', icon: <Network /> }]}
          />
        )}
        {inAdmin && me.memberships[0] && (
          <NavSection
            title={t('nav.section.console')}
            onNavigate={onNavigate}
            items={[{ to: `/o/${me.memberships[0].orgSlug}`, label: 'nav.backToConsole', icon: <Network /> }]}
          />
        )}
      </nav>
      <div className="border-t border-border p-3">
        <UserMenu me={me} />
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  if (!me.data) return null;

  return (
    <div className="flex h-full">
      <aside className="hidden w-[260px] shrink-0 border-r border-border bg-sidebar lg:block">
        <Sidebar me={me.data} />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[280px] max-w-[85vw] border-r border-border bg-sidebar shadow-pop">
            <button
              className="absolute top-4 right-3 rounded-md p-1.5 text-muted hover:bg-surface-3"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
            >
              <X className="size-5" />
            </button>
            <Sidebar me={me.data} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4 lg:hidden">
          <button
            className="rounded-md p-1.5 text-muted hover:bg-surface-3"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
          >
            <MenuIcon className="size-5" />
          </button>
          <img src="/logo-horizontal.png" alt="weblion.one" className="h-6 w-auto" />
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1320px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
