import { useQuery } from '@tanstack/react-query';
import type {
  BillingProfileDto,
  BillingSettingsDto,
  BillingStatsDto,
  BillingSummaryDto,
  CreditTransactionDto,
  Currency,
  DomainDto,
  InvoiceDetailDto,
  InvoiceDto,
  IntegrationsDto,
  InvoiceIssuerSettings,
  InvoiceStatus,
  Paginated,
  PaymentDto,
  ProductDto,
  SellerCustomerBillingDto,
  ServerDto,
  ServiceDto,
  WebspaceDto,
} from '@weblion/shared';
import { api } from '@/lib/api';
import { useMe } from '@/lib/queries';

/**
 * Query hooks for billing: the customer view (/orgs/:orgId/...), the seller view of one
 * customer (/billing/customers/:orgId/...), products, the admin overview and the issuer
 * settings. Every key starts with "billing", so a mutation can refresh the whole area with
 * billingKeys.all.
 */

export const billingKeys = {
  all: ['billing'] as const,
  org: (orgId: string, sub: string, params?: object) => ['billing', 'org', orgId, sub, params ?? {}] as const,
  invoice: (id: string) => ['billing', 'invoice', id] as const,
  payment: (id: string) => ['billing', 'payment', id] as const,
  seller: (orgId: string, sub: string, params?: object) =>
    ['billing', 'seller', orgId, sub, params ?? {}] as const,
  products: (owner: string | null, params?: object) =>
    ['billing', 'products', owner ?? 'platform', params ?? {}] as const,
  admin: (sub: string, params?: object) => ['billing', 'admin', sub, params ?? {}] as const,
  settings: ['billing', 'settings'] as const,
  issuer: (orgId: string) => ['billing', 'issuer', orgId] as const,
  resources: (orgId: string) => ['billing', 'resources', orgId] as const,
};

/**
 * Keys to refresh after something that can change an organization's modules (adding or
 * cancelling a service): billing plus the organization and admin lists that show modules.
 */
export const moduleChangeKeys = [billingKeys.all, ['org'], ['orgs'], ['admin'], ['reseller']];

/** GET /orgs/:orgId/credit and /billing/customers/:orgId/credit */
export interface CreditPageDto {
  balance: number;
  currency: Currency;
  items: CreditTransactionDto[];
  total: number;
  page: number;
  perPage: number;
}

/** POST /billing/customers/:orgId/invoices/generate */
export interface GenerateResult {
  invoice: InvoiceDetailDto | null;
  /** Due services in another currency than the customer's billing currency. */
  skipped?: { serviceId: string; name: string; currency: Currency }[];
}

/** POST /invoices/:id/pay */
export type PayResult =
  { status: 'paid' | 'partial'; amount: number } | { checkoutUrl: string; paymentId: string };

export interface CheckoutResult {
  checkoutUrl: string;
  paymentId: string;
}

export type MailSendResult = { status: 'sent' | 'failed' | 'skipped'; error?: string };

/** Invoice list filter. "overdue" is an open invoice past its due date. */
export type InvoiceFilter = InvoiceStatus | 'overdue' | '';

export interface InvoiceListParams {
  status?: InvoiceFilter;
  page?: number;
  perPage?: number;
}

export interface AdminInvoiceParams extends InvoiceListParams {
  q?: string;
  issuer?: 'platform' | 'reseller' | 'all';
}

export const PER_PAGE = 25;

// --- Customer view ----------------------------------------------------------------------

export const useBillingSummary = (orgId: string, enabled = true) =>
  useQuery({
    queryKey: billingKeys.org(orgId, 'summary'),
    queryFn: () => api.get<BillingSummaryDto>(`/orgs/${orgId}/billing/summary`),
    enabled,
  });

export const useOrgInvoices = (orgId: string, params: InvoiceListParams) =>
  useQuery({
    queryKey: billingKeys.org(orgId, 'invoices', params),
    queryFn: () =>
      api.get<Paginated<InvoiceDto>>(`/orgs/${orgId}/invoices`, { perPage: PER_PAGE, ...params }),
    placeholderData: (prev) => prev,
  });

export const useOrgServices = (orgId: string) =>
  useQuery({
    queryKey: billingKeys.org(orgId, 'services'),
    queryFn: () => api.get<ServiceDto[]>(`/orgs/${orgId}/services`),
  });

export const useOrgCredit = (orgId: string, page: number) =>
  useQuery({
    queryKey: billingKeys.org(orgId, 'credit', { page }),
    queryFn: () => api.get<CreditPageDto>(`/orgs/${orgId}/credit`, { page, perPage: PER_PAGE }),
    placeholderData: (prev) => prev,
  });

export const useOrgPayments = (orgId: string) =>
  useQuery({
    queryKey: billingKeys.org(orgId, 'payments'),
    queryFn: () => api.get<PaymentDto[]>(`/orgs/${orgId}/payments`),
  });

export const useBillingProfile = (orgId: string) =>
  useQuery({
    queryKey: billingKeys.org(orgId, 'profile'),
    queryFn: () => api.get<BillingProfileDto>(`/orgs/${orgId}/billing/profile`),
  });

export const useInvoice = (id: string | undefined) =>
  useQuery({
    queryKey: billingKeys.invoice(id ?? ''),
    queryFn: () => api.get<InvoiceDetailDto>(`/invoices/${id}`),
    enabled: !!id,
    retry: false,
  });

/** Polls a payment while it is pending (after the return from Stripe). */
export const usePayment = (id: string | null, poll: boolean) =>
  useQuery({
    queryKey: billingKeys.payment(id ?? ''),
    queryFn: () => api.get<PaymentDto>(`/payments/${id}`),
    enabled: !!id,
    retry: false,
    refetchInterval: (q) => (poll && (!q.state.data || q.state.data.status === 'pending') ? 2500 : false),
  });

// --- Seller view of one customer --------------------------------------------------------

export const useSellerCustomer = (orgId: string, enabled = true) =>
  useQuery({
    queryKey: billingKeys.seller(orgId, 'summary'),
    queryFn: () => api.get<SellerCustomerBillingDto>(`/billing/customers/${orgId}`),
    enabled,
    retry: false,
  });

export const useSellerInvoices = (orgId: string, params: InvoiceListParams) =>
  useQuery({
    queryKey: billingKeys.seller(orgId, 'invoices', params),
    queryFn: () =>
      api.get<Paginated<InvoiceDto>>(`/billing/customers/${orgId}/invoices`, {
        perPage: PER_PAGE,
        ...params,
      }),
    placeholderData: (prev) => prev,
  });

export const useSellerCredit = (orgId: string, page: number) =>
  useQuery({
    queryKey: billingKeys.seller(orgId, 'credit', { page }),
    queryFn: () => api.get<CreditPageDto>(`/billing/customers/${orgId}/credit`, { page, perPage: PER_PAGE }),
    placeholderData: (prev) => prev,
  });

export const useSellerServices = (orgId: string) =>
  useQuery({
    queryKey: billingKeys.seller(orgId, 'services'),
    queryFn: () => api.get<ServiceDto[]>(`/billing/customers/${orgId}/services`),
  });

export const useSellerPayments = (orgId: string) =>
  useQuery({
    queryKey: billingKeys.seller(orgId, 'payments'),
    queryFn: () => api.get<PaymentDto[]>(`/billing/customers/${orgId}/payments`),
  });

export interface ResourceOption {
  id: string;
  name: string;
}

export interface CustomerResources {
  servers: ResourceOption[];
  domains: ResourceOption[];
  webspaces: ResourceOption[];
}

/**
 * Resources a service can be linked to. A reseller reads them through its customer route,
 * platform staff through the organization lists. A list the caller can't read stays empty.
 */
export const useCustomerResources = (orgId: string, sellerOrgId: string | null, enabled: boolean) =>
  useQuery({
    queryKey: billingKeys.resources(orgId),
    enabled,
    queryFn: async (): Promise<CustomerResources> => {
      if (sellerOrgId) {
        const r = await api.get<CustomerResources>(`/orgs/${sellerOrgId}/customers/${orgId}/resources`);
        return { servers: r.servers, domains: r.domains, webspaces: r.webspaces };
      }
      const pick = (rows: { id: string; name: string }[]) => rows.map(({ id, name }) => ({ id, name }));
      const [servers, domains, webspaces] = await Promise.all([
        api.get<ServerDto[]>(`/orgs/${orgId}/servers`).then(pick, () => []),
        api.get<DomainDto[]>(`/orgs/${orgId}/domains`).then(pick, () => []),
        api.get<WebspaceDto[]>(`/orgs/${orgId}/webspaces`).then(pick, () => []),
      ]);
      return { servers, domains, webspaces };
    },
  });

// --- Products ---------------------------------------------------------------------------

export const useProducts = (ownerOrgId: string | null, opts: { active?: boolean; enabled?: boolean } = {}) =>
  useQuery({
    queryKey: billingKeys.products(ownerOrgId, { active: opts.active }),
    queryFn: () =>
      api.get<ProductDto[]>('/billing/products', {
        owner: ownerOrgId ?? 'platform',
        active: opts.active === undefined ? undefined : String(opts.active),
      }),
    enabled: opts.enabled ?? true,
  });

// --- Admin and settings -----------------------------------------------------------------

export const useAdminInvoices = (params: AdminInvoiceParams) =>
  useQuery({
    queryKey: billingKeys.admin('invoices', params),
    queryFn: () =>
      api.get<Paginated<InvoiceDto>>('/admin/billing/invoices', { perPage: PER_PAGE, ...params }),
    placeholderData: (prev) => prev,
  });

export const useBillingStats = () =>
  useQuery({
    queryKey: billingKeys.admin('stats'),
    queryFn: () => api.get<BillingStatsDto>('/admin/billing/stats'),
  });

export const useBillingSettings = (enabled = true) =>
  useQuery({
    queryKey: billingKeys.settings,
    queryFn: () => api.get<BillingSettingsDto>('/admin/settings/billing'),
    enabled,
  });

export const useResellerIssuer = (orgId: string | null, enabled = true) =>
  useQuery({
    queryKey: billingKeys.issuer(orgId ?? ''),
    queryFn: () => api.get<InvoiceIssuerSettings>(`/orgs/${orgId}/reseller/issuer`),
    enabled: enabled && !!orgId,
  });

/** Issuer settings of whoever bills a customer: the platform (null) or a reseller. */
export function useIssuerOf(sellerOrgId: string | null, enabled = true) {
  const platform = useBillingSettings(enabled && !sellerOrgId);
  const reseller = useResellerIssuer(sellerOrgId, enabled && !!sellerOrgId);
  return sellerOrgId ? reseller.data : platform.data?.issuer;
}

/**
 * Whether Zoho Books is set up, from GET /admin/integrations (same key as the settings
 * page, so both share the cache). undefined while unknown and for users outside the
 * admin area, who never see Zoho anyway.
 */
export function useZohoConfigured(): boolean | undefined {
  const me = useMe();
  const allowed = me.data?.platformPermissions.includes('platform:access') ?? false;
  const query = useQuery({
    queryKey: ['settings', 'integrations'],
    queryFn: () => api.get<IntegrationsDto>('/admin/integrations'),
    enabled: allowed,
    staleTime: 60_000,
  });
  return query.data?.zoho.configured;
}
