import { useEffect, type ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { setUnauthorizedHandler } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { OrgProvider } from '@/lib/org-context';
import { qk, useMe, useOrgBySlug } from '@/lib/queries';
import { AppShell } from '@/components/layout/app-shell';
import { EmptyState, ErrorState, Spinner } from '@/components/ui/primitives';
import { LoginPage } from '@/pages/auth/login';
import { InvitePage } from '@/pages/auth/invite';
import { AccountPage } from '@/pages/account/account';
import { OrgDashboard } from '@/pages/org/dashboard';
import { ProjectsPage, ProjectPage } from '@/pages/org/projects';
import { MembersPage } from '@/pages/org/members';
import { PoliciesPage, PolicyEditorPage } from '@/pages/org/policies';
import { TokensPage } from '@/pages/org/tokens';
import { OrgAuditPage } from '@/pages/org/audit';
import { OrgSettingsPage } from '@/pages/org/settings';
import { ServersPage } from '@/pages/servers/list';
import { ServerDetailPage } from '@/pages/servers/detail';
import { AdminDashboard } from '@/pages/admin/dashboard';
import { CustomersPage, CustomerDetailPage } from '@/pages/admin/customers';
import { UsersPage } from '@/pages/admin/users';
import { InventoryPage } from '@/pages/admin/inventory';
import { ProvidersPage, ProviderDetailPage } from '@/pages/admin/providers';
import { ExplorerPage } from '@/pages/admin/explorer';
import { AdminAuditPage } from '@/pages/admin/audit';
import { Building2 } from 'lucide-react';

function FullScreenSpinner() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner className="size-6" />
    </div>
  );
}

function UnauthorizedRedirect() {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  useEffect(() => {
    setUnauthorizedHandler(() => {
      qc.removeQueries({ queryKey: qk.me });
      if (!location.pathname.startsWith('/login')) {
        navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
      }
    });
  }, [navigate, location, qc]);
  return null;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <FullScreenSpinner />;
  if (me.isError || !me.data || me.data.mfaPending) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  return <>{children}</>;
}

function RequirePlatform({ children }: { children: ReactNode }) {
  const me = useMe();
  if (!me.data?.platformPermissions.includes('platform:access')) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function HomeRedirect() {
  const me = useMe();
  const t = useT();
  if (!me.data) return <FullScreenSpinner />;
  const first = me.data.memberships[0];
  if (first) return <Navigate to={`/o/${first.orgSlug}`} replace />;
  if (me.data.platformPermissions.includes('platform:access')) return <Navigate to="/admin" replace />;
  return (
    <AppShell>
      <EmptyState
        icon={<Building2 className="size-6" />}
        title={t('home.noOrgs.title')}
        description={t('home.noOrgs.text')}
      />
    </AppShell>
  );
}

function OrgLayout() {
  const { slug } = useParams();
  const org = useOrgBySlug(slug);
  if (org.isPending) return <FullScreenSpinner />;
  if (org.isError || !org.data) {
    return (
      <AppShell>
        <ErrorState error={org.error} />
      </AppShell>
    );
  }
  return (
    <OrgProvider org={org.data}>
      <AppShell>
        <Outlet />
      </AppShell>
    </OrgProvider>
  );
}

function AdminLayout() {
  return (
    <RequirePlatform>
      <AppShell>
        <Outlet />
      </AppShell>
    </RequirePlatform>
  );
}

export function App() {
  return (
    <>
      <UnauthorizedRedirect />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <HomeRedirect />
            </RequireAuth>
          }
        />
        <Route
          path="/account"
          element={
            <RequireAuth>
              <AppShell>
                <AccountPage />
              </AppShell>
            </RequireAuth>
          }
        />
        <Route
          path="/o/:slug"
          element={
            <RequireAuth>
              <OrgLayout />
            </RequireAuth>
          }
        >
          <Route index element={<OrgDashboard />} />
          <Route path="servers" element={<ServersPage />} />
          <Route path="servers/:serverId/*" element={<ServerDetailPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:projectId" element={<ProjectPage />} />
          <Route path="members" element={<MembersPage />} />
          <Route path="policies" element={<PoliciesPage />} />
          <Route path="policies/:policyId" element={<PolicyEditorPage />} />
          <Route path="tokens" element={<TokensPage />} />
          <Route path="audit" element={<OrgAuditPage />} />
          <Route path="settings" element={<OrgSettingsPage />} />
        </Route>
        <Route
          path="/admin"
          element={
            <RequireAuth>
              <AdminLayout />
            </RequireAuth>
          }
        >
          <Route index element={<AdminDashboard />} />
          <Route path="customers" element={<CustomersPage />} />
          <Route path="customers/:orgId" element={<CustomerDetailPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="servers" element={<InventoryPage />} />
          <Route path="providers" element={<ProvidersPage />} />
          <Route path="providers/:providerId" element={<ProviderDetailPage />} />
          <Route path="explorer" element={<ExplorerPage />} />
          <Route path="audit" element={<AdminAuditPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
