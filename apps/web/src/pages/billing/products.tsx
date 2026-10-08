import { useEffect, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  FileText,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  Tags,
  Trash2,
} from 'lucide-react';
import {
  BILLING_INTERVALS,
  CURRENCIES,
  MODULES,
  type BillingInterval,
  type Currency,
  type ModuleKey,
  type ProductDto,
} from '@weblion/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { useOrg } from '@/lib/org-context';
import { useApiMutation, useMe } from '@/lib/queries';
import { billingKeys, useIssuerOf, useProducts } from '@/lib/api/billing';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Menu, MenuItem, MenuSeparator, Switch } from '@/components/ui/menu';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Select,
  Textarea,
} from '@/components/ui/primitives';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';
import { NoBillingAccess, PriceText, Tabs, useBillingLabels, useSellerWrite, useTabParam } from './bits';
import { formatRate, moneyInput, parseMoney, parsePercent, percentInput } from './money';
import { ResellerIssuerForm } from './settings-form';

/**
 * Price list ("Produkte & Preise") of the platform or of a reseller. Services are created
 * from these products; changing a price only affects services created afterwards.
 */

interface ProductDraft {
  name: string;
  description: string;
  module: ModuleKey | '';
  unitPrice: string;
  currency: Currency;
  interval: BillingInterval;
  taxRate: string;
  active: boolean;
}

function ProductDialog({
  open,
  onOpenChange,
  ownerOrgId,
  product,
  defaultCurrency,
  defaultTaxRateBp,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ownerOrgId: string | null;
  product: ProductDto | null;
  defaultCurrency: Currency;
  defaultTaxRateBp: number | undefined;
}) {
  const { t, locale } = useI18n();
  const labels = useBillingLabels();
  const [draft, setDraft] = useState<ProductDraft>({
    name: '',
    description: '',
    module: '',
    unitPrice: '',
    currency: defaultCurrency,
    interval: 'monthly',
    taxRate: '',
    active: true,
  });
  const set = (patch: Partial<ProductDraft>) => setDraft((d) => ({ ...d, ...patch }));

  useEffect(() => {
    if (!open) return;
    setDraft(
      product
        ? {
            name: product.name,
            description: product.description ?? '',
            module: product.module ?? '',
            unitPrice: moneyInput(product.unitPrice),
            currency: product.currency,
            interval: product.interval,
            taxRate: percentInput(product.taxRateBp),
            active: product.active,
          }
        : {
            name: '',
            description: '',
            module: '',
            unitPrice: '',
            currency: defaultCurrency,
            interval: 'monthly',
            taxRate: '',
            active: true,
          },
    );
  }, [open, product, defaultCurrency]);

  const price = parseMoney(draft.unitPrice);
  const priceOk = price !== null && price >= 0;
  const taxBp = draft.taxRate.trim() === '' ? null : parsePercent(draft.taxRate);
  const taxOk = draft.taxRate.trim() === '' || taxBp !== null;
  const valid = !!draft.name.trim() && priceOk && taxOk;

  const save = useApiMutation(
    () => {
      const body = {
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        module: draft.module || null,
        unitPrice: price,
        currency: draft.currency,
        interval: draft.interval,
        taxRateBp: taxBp,
        active: draft.active,
      };
      return product
        ? api.patch<ProductDto>(`/billing/products/${product.id}`, body)
        : api.post<ProductDto>('/billing/products', { ...body, ownerOrgId });
    },
    {
      success: product ? t('common.saved') : t('billing.product.created'),
      invalidate: [billingKeys.all],
      onSuccess: () => onOpenChange(false),
    },
  );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={product ? t('billing.product.editTitle') : t('billing.product.createTitle')}
      description={product ? t('billing.product.editText') : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!valid}
            loading={save.isPending}
            onClick={() => save.mutate(undefined)}
          >
            {product ? t('common.save') : t('billing.product.create')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('billing.col.name')} htmlFor="pr-name" className="sm:col-span-2">
          <Input
            id="pr-name"
            value={draft.name}
            maxLength={200}
            onChange={(e) => set({ name: e.target.value })}
            placeholder={t('billing.product.namePlaceholder')}
            autoFocus
          />
        </Field>
        <Field
          label={t('billing.col.description')}
          htmlFor="pr-desc"
          hint={t('billing.product.descriptionHint')}
          className="sm:col-span-2"
        >
          <Textarea
            id="pr-desc"
            rows={2}
            maxLength={1000}
            value={draft.description}
            onChange={(e) => set({ description: e.target.value })}
          />
        </Field>
        <Field
          label={t('billing.col.unitPrice')}
          htmlFor="pr-price"
          error={draft.unitPrice.trim() && !priceOk ? t('billing.amountError') : undefined}
        >
          <Input
            id="pr-price"
            inputMode="decimal"
            placeholder="0.00"
            value={draft.unitPrice}
            onChange={(e) => set({ unitPrice: e.target.value })}
            className="tabular"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('billing.profile.currency')} htmlFor="pr-currency">
            <Select
              id="pr-currency"
              value={draft.currency}
              onChange={(e) => set({ currency: e.target.value as Currency })}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('billing.col.interval')} htmlFor="pr-interval">
            <Select
              id="pr-interval"
              value={draft.interval}
              onChange={(e) => set({ interval: e.target.value as BillingInterval })}
            >
              {BILLING_INTERVALS.map((i) => (
                <option key={i} value={i}>
                  {labels.interval(i)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field
          label={t('billing.col.taxRate')}
          htmlFor="pr-tax"
          hint={
            defaultTaxRateBp !== undefined
              ? t('billing.taxDefaultHint', { rate: formatRate(defaultTaxRateBp, locale) })
              : undefined
          }
          error={!taxOk ? t('billing.rateError') : undefined}
        >
          <Input
            id="pr-tax"
            inputMode="decimal"
            value={draft.taxRate}
            placeholder={percentInput(defaultTaxRateBp)}
            onChange={(e) => set({ taxRate: e.target.value })}
          />
        </Field>
        <Field label={t('billing.col.module')} htmlFor="pr-module" hint={t('billing.product.moduleHint')}>
          <Select
            id="pr-module"
            value={draft.module}
            onChange={(e) => set({ module: e.target.value as ModuleKey | '' })}
          >
            <option value="">{t('billing.module.none')}</option>
            {MODULES.map((m) => (
              <option key={m} value={m}>
                {labels.module(m)}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5 sm:col-span-2">
          <span>
            <span className="block text-sm font-medium text-text">{t('billing.product.active')}</span>
            <span className="block text-xs text-muted">{t('billing.product.activeHint')}</span>
          </span>
          <Switch
            checked={draft.active}
            onCheckedChange={(v) => set({ active: v })}
            label={t('billing.product.active')}
          />
        </label>
      </div>
    </Dialog>
  );
}

/** Product table with create, edit, (de)activate and delete. */
export function ProductCatalog({ ownerOrgId }: { ownerOrgId: string | null }) {
  const { t, locale } = useI18n();
  const labels = useBillingLabels();
  const me = useMe();
  const resellerWrite = useSellerWrite(ownerOrgId ?? undefined);
  const canWrite = ownerOrgId
    ? resellerWrite
    : (me.data?.platformPermissions.includes('platform:billing:write') ?? false);
  const products = useProducts(ownerOrgId);
  const issuer = useIssuerOf(ownerOrgId);
  const [editing, setEditing] = useState<ProductDto | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ProductDto | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const toggle = useApiMutation(
    (p: ProductDto) => api.patch<ProductDto>(`/billing/products/${p.id}`, { active: !p.active }),
    {
      success: (p) =>
        p.active
          ? t('billing.product.activated', { name: p.name })
          : t('billing.product.deactivated', { name: p.name }),
      invalidate: [billingKeys.all],
    },
  );
  const remove = useApiMutation(
    (p: ProductDto) => api.del<{ ok: true; deactivated: boolean }>(`/billing/products/${p.id}`),
    {
      success: (r, p) =>
        r.deactivated
          ? t('billing.product.deactivatedInUse', { name: p.name })
          : t('billing.product.deleted', { name: p.name }),
      invalidate: [billingKeys.all],
      onSuccess: () => setDeleting(null),
    },
  );

  const all = products.data ?? [];
  const inactive = all.filter((p) => !p.active).length;
  const rows = showInactive ? all : all.filter((p) => p.active);

  return (
    <Card>
      <CardHeader
        title={t('billing.products.title')}
        description={t('billing.products.text')}
        actions={
          <>
            {inactive > 0 && (
              <label className="flex items-center gap-2 text-[13px] text-muted">
                <Switch
                  checked={showInactive}
                  onCheckedChange={setShowInactive}
                  label={t('billing.products.showInactive', { n: inactive })}
                />
                {t('billing.products.showInactive', { n: inactive })}
              </label>
            )}
            {canWrite && (
              <Button
                size="sm"
                variant="primary"
                icon={<Plus className="size-4" />}
                onClick={() => setEditing('new')}
              >
                {t('billing.product.create')}
              </Button>
            )}
          </>
        }
      />
      {products.isPending ? (
        <LoadingBlock />
      ) : products.isError ? (
        <div className="p-5">
          <ErrorState error={products.error} onRetry={() => void products.refetch()} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Package className="size-6" />}
          title={t('billing.products.none')}
          description={canWrite ? t('billing.products.noneText') : undefined}
          action={
            canWrite && (
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
                {t('billing.product.create')}
              </Button>
            )
          }
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>{t('billing.col.product')}</TH>
              <TH className="hidden md:table-cell">{t('billing.col.module')}</TH>
              <TH className="text-right">{t('billing.col.price')}</TH>
              <TH className="hidden text-right sm:table-cell">{t('billing.col.taxRate')}</TH>
              <TH>{t('billing.col.status')}</TH>
              {canWrite && <TH />}
            </tr>
          </THead>
          <TBody>
            {rows.map((p) => (
              <tr key={p.id} className={cn(!p.active && 'opacity-70')}>
                <TD className="min-w-[180px]">
                  <div className="font-medium text-text">{p.name}</div>
                  {p.description && <div className="max-w-md text-xs text-muted">{p.description}</div>}
                </TD>
                <TD className="hidden text-muted md:table-cell">
                  {p.module ? labels.module(p.module) : '–'}
                </TD>
                <TD className="text-right">
                  <PriceText amount={p.unitPrice} currency={p.currency} interval={p.interval} />
                  {p.interval === 'once' && (
                    <div className="text-xs text-muted">{labels.interval('once')}</div>
                  )}
                </TD>
                <TD className="hidden text-right whitespace-nowrap text-muted tabular sm:table-cell">
                  {p.taxRateBp !== null
                    ? formatRate(p.taxRateBp, locale)
                    : issuer
                      ? t('billing.products.defaultRateValue', {
                          rate: formatRate(issuer.defaultTaxRateBp, locale),
                        })
                      : t('billing.products.defaultRate')}
                </TD>
                <TD>
                  <Badge tone={p.active ? 'success' : 'neutral'}>
                    {p.active ? t('billing.product.isActive') : t('billing.product.isInactive')}
                  </Badge>
                </TD>
                {canWrite && (
                  <TD className="w-10 text-right">
                    <Menu
                      trigger={
                        <Button size="icon" variant="ghost" aria-label={t('common.actions')}>
                          <MoreHorizontal className="size-4" />
                        </Button>
                      }
                    >
                      <MenuItem icon={<Pencil />} onSelect={() => setEditing(p)}>
                        {t('common.edit')}
                      </MenuItem>
                      <MenuItem
                        icon={p.active ? <Archive /> : <ArchiveRestore />}
                        hint={p.active ? t('billing.product.deactivateHint') : undefined}
                        onSelect={() => toggle.mutate(p)}
                      >
                        {p.active ? t('billing.product.deactivate') : t('billing.product.activate')}
                      </MenuItem>
                      <MenuSeparator />
                      <MenuItem icon={<Trash2 />} danger onSelect={() => setDeleting(p)}>
                        {t('common.delete')}
                      </MenuItem>
                    </Menu>
                  </TD>
                )}
              </tr>
            ))}
          </TBody>
        </Table>
      )}
      {canWrite && (
        <>
          <ProductDialog
            open={editing !== null}
            onOpenChange={(o) => !o && setEditing(null)}
            ownerOrgId={ownerOrgId}
            product={editing === 'new' ? null : editing}
            defaultCurrency={issuer?.defaultCurrency ?? 'CHF'}
            defaultTaxRateBp={issuer?.defaultTaxRateBp}
          />
          <ConfirmDialog
            open={!!deleting}
            onOpenChange={(o) => !o && setDeleting(null)}
            title={t('billing.product.deleteTitle', { name: deleting?.name ?? '' })}
            description={t('billing.product.deleteText')}
            confirmLabel={t('common.delete')}
            loading={remove.isPending}
            onConfirm={() => deleting && remove.mutate(deleting)}
          />
        </>
      )}
    </Card>
  );
}

export function AdminProductsPage() {
  const { t } = useI18n();
  const me = useMe();
  const perms = me.data?.platformPermissions ?? [];
  if (me.data && !perms.includes('platform:billing:read') && !perms.includes('platform:billing:write')) {
    return (
      <>
        <PageHeader title={t('nav.admin.products')} />
        <NoBillingAccess />
      </>
    );
  }
  return (
    <>
      <PageHeader title={t('nav.admin.products')} description={t('billing.products.adminSubtitle')} />
      <ProductCatalog ownerOrgId={null} />
    </>
  );
}

const RESELLER_TABS = ['products', 'issuer'] as const;

export function ResellerProductsPage() {
  const { t } = useI18n();
  const { org, can } = useOrg();
  const [tab, setTab] = useTabParam(RESELLER_TABS, 'products');
  if (org.kind !== 'reseller' || !can('reseller:billing')) {
    return (
      <>
        <PageHeader title={t('nav.products')} />
        <NoBillingAccess
          text={
            org.kind !== 'reseller'
              ? t('billing.products.notReseller')
              : t('billing.products.noAccessReseller')
          }
        />
      </>
    );
  }
  return (
    <>
      <PageHeader title={t('nav.products')} description={t('billing.products.resellerSubtitle')} />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'products', label: t('billing.products.title'), icon: <Tags /> },
          { key: 'issuer', label: t('billing.issuer.tab'), icon: <FileText /> },
        ]}
      />
      {tab === 'products' ? <ProductCatalog ownerOrgId={org.id} /> : <ResellerIssuerForm orgId={org.id} />}
    </>
  );
}
