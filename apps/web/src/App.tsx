import { lazy, Suspense, useEffect, type ReactNode } from 'react';
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
import { OrgDashboard } from '@/pages/org/dashboard';
import { ProjectsPage, ProjectPage } from '@/pages/org/projects';
import { MembersPage } from '@/pages/org/members';
import { TokensPage } from '@/pages/org/tokens';
import { OrgAuditPage } from '@/pages/org/audit';
import { OrgSettingsPage } from '@/pages/org/settings';
import { ServersPage } from '@/pages/servers/list';
import { Building2 } from 'lucide-react';

// Less frequently used areas (admin, policy editor) and the chart-heavy server page load on demand.
const AccountPage = lazy(() => import('@/pages/account/account').then((m) => ({ default: m.AccountPage })));
const PoliciesPage = lazy(() => import('@/pages/org/policies').then((m) => ({ default: m.PoliciesPage })));
const PolicyEditorPage = lazy(() =>
  import('@/pages/org/policies').then((m) => ({ default: m.PolicyEditorPage })),
);
const ServerDetailPage = lazy(() =>
  import('@/pages/servers/detail').then((m) => ({ default: m.ServerDetailPage })),
);
const AdminDashboard = lazy(() =>
  import('@/pages/admin/dashboard').then((m) => ({ default: m.AdminDashboard })),
);
const CustomersPage = lazy(() =>
  import('@/pages/admin/customers').then((m) => ({ default: m.CustomersPage })),
);
const CustomerDetailPage = lazy(() =>
  import('@/pages/admin/customers').then((m) => ({ default: m.CustomerDetailPage })),
);
const UsersPage = lazy(() => import('@/pages/admin/users').then((m) => ({ default: m.UsersPage })));
const InventoryPage = lazy(() =>
  import('@/pages/admin/inventory').then((m) => ({ default: m.InventoryPage })),
);
const ProvidersPage = lazy(() =>
  import('@/pages/admin/providers').then((m) => ({ default: m.ProvidersPage })),
);
const ProviderDetailPage = lazy(() =>
  import('@/pages/admin/providers').then((m) => ({ default: m.ProviderDetailPage })),
);
const ExplorerPage = lazy(() => import('@/pages/admin/explorer').then((m) => ({ default: m.ExplorerPage })));
const AdminAuditPage = lazy(() => import('@/pages/admin/audit').then((m) => ({ default: m.AdminAuditPage })));

// Billing, reseller, hosting and settings areas.
const BillingPage = lazy(() =>
  import('@/pages/billing/org-billing').then((m) => ({ default: m.BillingPage })),
);
const InvoicePage = lazy(() =>
  import('@/pages/billing/org-billing').then((m) => ({ default: m.InvoicePage })),
);
const AdminProductsPage = lazy(() =>
  import('@/pages/billing/products').then((m) => ({ default: m.AdminProductsPage })),
);
const ResellerProductsPage = lazy(() =>
  import('@/pages/billing/products').then((m) => ({ default: m.ResellerProductsPage })),
);
const AdminBillingPage = lazy(() =>
  import('@/pages/billing/admin-billing').then((m) => ({ default: m.AdminBillingPage })),
);
const AdminInvoicePage = lazy(() =>
  import('@/pages/billing/admin-billing').then((m) => ({ default: m.AdminInvoicePage })),
);
const ResellerCustomersPage = lazy(() =>
  import('@/pages/reseller/customers').then((m) => ({ default: m.ResellerCustomersPage })),
);
const ResellerCustomerPage = lazy(() =>
  import('@/pages/reseller/customers').then((m) => ({ default: m.ResellerCustomerPage })),
);
const AdminSettingsPage = lazy(() =>
  import('@/pages/admin/settings').then((m) => ({ default: m.AdminSettingsPage })),
);
const DomainsPage = lazy(() => import('@/pages/hosting/domains').then((m) => ({ default: m.DomainsPage })));
const DomainDetailPage = lazy(() =>
  import('@/pages/hosting/domains').then((m) => ({ default: m.DomainDetailPage })),
);
const WebspacesPage = lazy(() =>
  import('@/pages/hosting/webhosting').then((m) => ({ default: m.WebspacesPage })),
);
const WebspaceDetailPage = lazy(() =>
  import('@/pages/hosting/webhosting').then((m) => ({ default: m.WebspaceDetailPage })),
);
const AdminHostingPage = lazy(() =>
  import('@/pages/admin/hosting').then((m) => ({ default: m.AdminHostingPage })),
);
const CloudPage = lazy(() => import('@/pages/cloud/cloud').then((m) => ({ default: m.CloudPage })));
const MailDomainsPage = lazy(() => import('@/pages/mail/mail').then((m) => ({ default: m.MailDomainsPage })));
const MailDomainDetailPage = lazy(() =>
  import('@/pages/mail/domain').then((m) => ({ default: m.MailDomainDetailPage })),
);

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
      <Suspense fallback={<FullScreenSpinner />}>
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
            <Route path="billing" element={<BillingPage />} />
            <Route path="billing/invoices/:invoiceId" element={<InvoicePage />} />
            <Route path="domains" element={<DomainsPage />} />
            <Route path="domains/:domainId" element={<DomainDetailPage />} />
            <Route path="webhosting" element={<WebspacesPage />} />
            <Route path="webhosting/:webspaceId" element={<WebspaceDetailPage />} />
            <Route path="cloud" element={<CloudPage />} />
            <Route path="mail" element={<MailDomainsPage />} />
            <Route path="mail/:mailDomainId" element={<MailDomainDetailPage />} />
            <Route path="customers" element={<ResellerCustomersPage />} />
            <Route path="customers/:customerId" element={<ResellerCustomerPage />} />
            <Route path="products" element={<ResellerProductsPage />} />
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
            <Route path="hosting" element={<AdminHostingPage />} />
            <Route path="billing" element={<AdminBillingPage />} />
            <Route path="billing/invoices/:invoiceId" element={<AdminInvoicePage />} />
            <Route path="products" element={<AdminProductsPage />} />
            <Route path="settings" element={<AdminSettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
