import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  BILLING_INTERVALS,
  MODULES,
  formatMoney,
  type BillingInterval,
  type CreditTransactionDto,
  type Currency,
  type ModuleKey,
  type ProductDto,
  type SellerCustomerBillingDto,
  type ServiceDto,
  type ServiceResourceType,
} from '@weblion/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { useApiMutation } from '@/lib/queries';
import {
  billingKeys,
  moduleChangeKeys,
  useCustomerResources,
  useProducts,
  type GenerateResult,
} from '@/lib/api/billing';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/menu';
import { Field, Input, Notice, Select, Textarea } from '@/components/ui/primitives';
import { useBillingLabels } from './bits';
import {
  formatRate,
  moneyInput,
  parseMoney,
  parsePercent,
  parseQuantity,
  percentInput,
  todayISO,
} from './money';

/** Dialogs of the seller panel: credit, services and billing due services. */

type Customer = SellerCustomerBillingDto;

function SwitchRow({
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-text">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} label={label} disabled={disabled} />
    </label>
  );
}

/** Two or three options side by side, like a radio group. */
function Segmented<V extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: V;
  onChange: (v: V) => void;
  options: { value: V; label: string; disabled?: boolean }[];
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg border border-border bg-surface-2 p-1"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
            value === o.value ? 'bg-surface text-text shadow-card' : 'text-muted hover:text-text',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// --- Credit -------------------------------------------------------------------------------

type BookType = 'topup' | 'adjustment' | 'refund';

/** "Guthaben buchen": credit note, correction or refund, adding or taking credit away. */
export function CreditBookDialog({
  open,
  onOpenChange,
  customer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: Customer;
}) {
  const { t, locale } = useI18n();
  const { currency, balance } = customer.summary;
  const [type, setType] = useState<BookType>('topup');
  const [direction, setDirection] = useState<'add' | 'deduct'>('add');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [notify, setNotify] = useState(true);

  useEffect(() => {
    if (!open) return;
    setType('topup');
    setDirection('add');
    setAmount('');
    setDescription('');
    setNotify(true);
  }, [open]);

  const money = (v: number) => formatMoney(v, currency, locale);
  const parsed = parseMoney(amount);
  const positive = parsed !== null && parsed > 0;
  const signed = positive ? (direction === 'deduct' ? -parsed : parsed) : null;
  const tooMuch = signed !== null && balance + signed < 0;
  const valid = signed !== null && !tooMuch && description.trim().length > 0;

  const book = useApiMutation(
    () =>
      api.post<CreditTransactionDto>(`/billing/customers/${customer.org.id}/credit`, {
        amount: signed,
        type,
        description: description.trim(),
        notify,
      }),
    {
      success: (tx) => t('billing.book.done', { amount: money(tx.amount), balance: money(tx.balanceAfter) }),
      invalidate: [billingKeys.all, ['admin'], ['reseller']],
      onSuccess: () => onOpenChange(false),
    },
  );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={t('billing.book.title')}
      description={t('billing.book.text', { name: customer.org.name, balance: money(balance) })}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!valid}
            loading={book.isPending}
            onClick={() => book.mutate(undefined)}
          >
            {t('billing.book.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('billing.col.type')} htmlFor="book-type" hint={t(`billing.book.typeHint.${type}`)}>
          <Select
            id="book-type"
            value={type}
            onChange={(e) => {
              const next = e.target.value as BookType;
              setType(next);
              if (next === 'topup') setDirection('add');
            }}
          >
            <option value="topup">{t('billing.creditType.topup')}</option>
            <option value="adjustment">{t('billing.creditType.adjustment')}</option>
            <option value="refund">{t('billing.creditType.refund')}</option>
          </Select>
        </Field>
        <Segmented
          label={t('billing.book.direction')}
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'add', label: t('billing.book.add') },
            { value: 'deduct', label: t('billing.book.deduct'), disabled: type === 'topup' },
          ]}
        />
        <Field
          label={`${t('billing.col.amount')} (${currency})`}
          htmlFor="book-amount"
          error={
            amount.trim() && !positive
              ? t('billing.amountError')
              : tooMuch
                ? t('billing.book.tooMuch', { balance: money(balance) })
                : undefined
          }
          hint={signed !== null ? t('billing.book.after', { balance: money(balance + signed) }) : undefined}
        >
          <Input
            id="book-amount"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="tabular"
            autoFocus
          />
        </Field>
        <Field
          label={t('billing.col.description')}
          htmlFor="book-desc"
          hint={t('billing.book.descriptionHint')}
        >
          <Input
            id="book-desc"
            value={description}
            maxLength={300}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t(`billing.book.placeholder.${type}`)}
          />
        </Field>
        <SwitchRow
          label={t('billing.book.notify')}
          hint={t('billing.book.notifyHint')}
          checked={notify}
          onCheckedChange={setNotify}
        />
      </div>
    </Dialog>
  );
}

// --- Services -----------------------------------------------------------------------------

const moduleOfResource: Record<ServiceResourceType, ModuleKey> = {
  server: 'servers',
  domain: 'dns',
  webspace: 'webhosting',
};

interface ServiceDraft {
  productId: string;
  name: string;
  description: string;
  module: ModuleKey | '';
  /** "<type>:<id>" or "" */
  resource: string;
  unitPrice: string;
  quantity: string;
  interval: BillingInterval;
  taxRate: string;
  startsAt: string;
  notes: string;
  activateModule: boolean;
}

const emptyService = (): ServiceDraft => ({
  productId: '',
  name: '',
  description: '',
  module: '',
  resource: '',
  unitPrice: '',
  quantity: '1',
  interval: 'monthly',
  taxRate: '',
  startsAt: todayISO(),
  notes: '',
  activateModule: true,
});

/** "Dienst hinzufügen": from a product of the seller's catalog or free, optionally linked to a resource. */
export function AddServiceDialog({
  open,
  onOpenChange,
  customer,
  defaultTaxRateBp,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: Customer;
  defaultTaxRateBp: number | undefined;
}) {
  const { t, locale } = useI18n();
  const labels = useBillingLabels();
  const sellerOrgId = customer.seller.orgId;
  const currency: Currency = customer.profile.currency;
  const products = useProducts(sellerOrgId, { active: true, enabled: open });
  const resources = useCustomerResources(customer.org.id, sellerOrgId, open);
  const [draft, setDraft] = useState<ServiceDraft>(emptyService);
  const set = (patch: Partial<ServiceDraft>) => setDraft((d) => ({ ...d, ...patch }));

  useEffect(() => {
    if (open) setDraft(emptyService());
  }, [open]);

  const catalog = (products.data ?? []).filter((p) => p.currency === currency);
  const otherCurrency = (products.data ?? []).length - catalog.length;

  const pickProduct = (product: ProductDto | undefined) => {
    if (!product) {
      set({ productId: '' });
      return;
    }
    set({
      productId: product.id,
      name: product.name,
      description: product.description ?? '',
      module: product.module ?? '',
      unitPrice: moneyInput(product.unitPrice),
      interval: product.interval,
      taxRate: percentInput(product.taxRateBp),
    });
  };

  const pickResource = (value: string) => {
    const type = value.split(':')[0] as ServiceResourceType | '';
    // A resource implies its module unless one was chosen already.
    set({ resource: value, ...(type && !draft.module ? { module: moduleOfResource[type] } : {}) });
  };

  const price = parseMoney(draft.unitPrice);
  const quantity = parseQuantity(draft.quantity);
  const taxBp = draft.taxRate.trim() === '' ? null : parsePercent(draft.taxRate);
  const priceOk = price !== null && price >= 0;
  const taxOk = draft.taxRate.trim() === '' || taxBp !== null;
  const valid = draft.name.trim() && priceOk && quantity !== null && taxOk && !!draft.startsAt;
  const moduleActive = draft.module ? customer.org.modules.includes(draft.module) : true;

  const create = useApiMutation(
    () => {
      const [resourceType, resourceId] = draft.resource ? draft.resource.split(':') : [null, null];
      return api.post<ServiceDto>(`/billing/customers/${customer.org.id}/services`, {
        productId: draft.productId || undefined,
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        module: draft.module || null,
        resourceType,
        resourceId,
        unitPrice: price,
        quantity,
        interval: draft.interval,
        taxRateBp: taxBp,
        startsAt: draft.startsAt,
        notes: draft.notes.trim() || null,
        activateModule: draft.activateModule,
      });
    },
    {
      success: (s) => t('billing.service.created', { name: s.name }),
      invalidate: moduleChangeKeys,
      onSuccess: () => onOpenChange(false),
    },
  );

  const res = resources.data;
  const hasResources = !!res && res.servers.length + res.domains.length + res.webspaces.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={t('billing.service.addTitle')}
      description={t('billing.service.addText', { name: customer.org.name })}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!valid}
            loading={create.isPending}
            onClick={() => create.mutate(undefined)}
          >
            {t('billing.service.add')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label={t('billing.service.product')}
          htmlFor="svc-product"
          hint={
            otherCurrency > 0
              ? t('billing.service.productCurrencyHint', { currency })
              : t('billing.service.productHint')
          }
        >
          <Select
            id="svc-product"
            value={draft.productId}
            onChange={(e) => pickProduct(catalog.find((p) => p.id === e.target.value))}
          >
            <option value="">{t('billing.service.noProduct')}</option>
            {catalog.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {formatMoney(p.unitPrice, p.currency, locale)} {labels.interval(p.interval)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('billing.col.name')} htmlFor="svc-name">
            <Input
              id="svc-name"
              value={draft.name}
              maxLength={200}
              onChange={(e) => set({ name: e.target.value })}
            />
          </Field>
          <Field label={t('billing.col.description')} htmlFor="svc-desc" hint={t('common.optional')}>
            <Input
              id="svc-desc"
              value={draft.description}
              maxLength={1000}
              onChange={(e) => set({ description: e.target.value })}
            />
          </Field>
          <Field
            label={`${t('billing.col.unitPrice')} (${currency})`}
            htmlFor="svc-price"
            error={draft.unitPrice.trim() && !priceOk ? t('billing.amountError') : undefined}
          >
            <Input
              id="svc-price"
              inputMode="decimal"
              placeholder="0.00"
              value={draft.unitPrice}
              onChange={(e) => set({ unitPrice: e.target.value })}
              className="tabular"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={t('billing.line.quantity')}
              htmlFor="svc-qty"
              error={quantity === null ? t('billing.quantityError') : undefined}
            >
              <Input
                id="svc-qty"
                inputMode="decimal"
                value={draft.quantity}
                onChange={(e) => set({ quantity: e.target.value })}
                className="tabular"
              />
            </Field>
            <Field label={t('billing.col.interval')} htmlFor="svc-interval">
              <Select
                id="svc-interval"
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
            htmlFor="svc-tax"
            hint={
              defaultTaxRateBp !== undefined
                ? t('billing.taxDefaultHint', {
                    rate: formatRate(customer.profile.taxRateBp ?? defaultTaxRateBp, locale),
                  })
                : undefined
            }
            error={!taxOk ? t('billing.rateError') : undefined}
          >
            <Input
              id="svc-tax"
              inputMode="decimal"
              value={draft.taxRate}
              placeholder={percentInput(customer.profile.taxRateBp ?? defaultTaxRateBp)}
              onChange={(e) => set({ taxRate: e.target.value })}
            />
          </Field>
          <Field
            label={t('billing.service.startsAt')}
            htmlFor="svc-start"
            hint={t('billing.service.startsAtHint')}
          >
            <Input
              id="svc-start"
              type="date"
              value={draft.startsAt}
              onChange={(e) => set({ startsAt: e.target.value })}
            />
          </Field>
          <Field label={t('billing.col.module')} htmlFor="svc-module" hint={t('billing.service.moduleHint')}>
            <Select
              id="svc-module"
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
          <Field
            label={t('billing.col.resource')}
            htmlFor="svc-resource"
            hint={
              resources.isError
                ? t('billing.service.resourcesError')
                : !resources.isPending && !hasResources
                  ? t('billing.service.noResources')
                  : t('billing.service.resourceHint')
            }
          >
            <Select
              id="svc-resource"
              value={draft.resource}
              onChange={(e) => pickResource(e.target.value)}
              disabled={!hasResources}
            >
              <option value="">{t('billing.service.noResource')}</option>
              {res && res.servers.length > 0 && (
                <optgroup label={t('billing.resource.servers')}>
                  {res.servers.map((r) => (
                    <option key={r.id} value={`server:${r.id}`}>
                      {r.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {res && res.domains.length > 0 && (
                <optgroup label={t('billing.resource.domains')}>
                  {res.domains.map((r) => (
                    <option key={r.id} value={`domain:${r.id}`}>
                      {r.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {res && res.webspaces.length > 0 && (
                <optgroup label={t('billing.resource.webspaces')}>
                  {res.webspaces.map((r) => (
                    <option key={r.id} value={`webspace:${r.id}`}>
                      {r.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>
          </Field>
        </div>
        {draft.module && !moduleActive && (
          <SwitchRow
            label={t('billing.service.activateModule', { module: labels.module(draft.module) })}
            hint={t('billing.service.activateModuleHint')}
            checked={draft.activateModule}
            onCheckedChange={(v) => set({ activateModule: v })}
          />
        )}
        <Field label={t('billing.col.notes')} htmlFor="svc-notes" hint={t('billing.service.notesHint')}>
          <Textarea
            id="svc-notes"
            rows={2}
            maxLength={2000}
            value={draft.notes}
            onChange={(e) => set({ notes: e.target.value })}
          />
        </Field>
      </div>
    </Dialog>
  );
}

/** Change price, quantity, tax, next billing date and notes of a service. */
export function EditServiceDialog({
  service,
  onOpenChange,
  defaultTaxRateBp,
}: {
  service: ServiceDto | null;
  onOpenChange: (open: boolean) => void;
  defaultTaxRateBp: number | undefined;
}) {
  const { t, locale } = useI18n();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [taxRate, setTaxRate] = useState('');
  const [nextBillingAt, setNextBillingAt] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!service) return;
    setName(service.name);
    setDescription(service.description ?? '');
    setUnitPrice(moneyInput(service.unitPrice));
    setQuantity(String(service.quantity));
    setTaxRate(percentInput(service.taxRateBp));
    setNextBillingAt(service.nextBillingAt ?? '');
    setNotes(service.notes ?? '');
  }, [service]);

  const price = parseMoney(unitPrice);
  const qty = parseQuantity(quantity);
  const taxBp = taxRate.trim() === '' ? null : parsePercent(taxRate);
  const taxOk = taxRate.trim() === '' || taxBp !== null;
  const valid = !!name.trim() && price !== null && price >= 0 && qty !== null && taxOk;

  const save = useApiMutation(
    () =>
      api.patch<ServiceDto>(`/services/${service!.id}`, {
        name: name.trim(),
        description: description.trim() || null,
        unitPrice: price,
        quantity: qty,
        taxRateBp: taxBp,
        nextBillingAt: nextBillingAt || null,
        notes: notes.trim() || null,
      }),
    {
      success: t('common.saved'),
      invalidate: [billingKeys.all],
      onSuccess: () => onOpenChange(false),
    },
  );

  return (
    <Dialog
      open={!!service}
      onOpenChange={onOpenChange}
      title={t('billing.service.editTitle')}
      description={t('billing.service.editText')}
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
            {t('common.save')}
          </Button>
        </>
      }
    >
      {service && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('billing.col.name')} htmlFor="es-name" className="sm:col-span-2">
            <Input id="es-name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('billing.col.description')} htmlFor="es-desc" className="sm:col-span-2">
            <Input
              id="es-desc"
              value={description}
              maxLength={1000}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field
            label={`${t('billing.col.unitPrice')} (${service.currency})`}
            htmlFor="es-price"
            error={unitPrice.trim() && (price === null || price < 0) ? t('billing.amountError') : undefined}
          >
            <Input
              id="es-price"
              inputMode="decimal"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              className="tabular"
            />
          </Field>
          <Field
            label={t('billing.line.quantity')}
            htmlFor="es-qty"
            error={qty === null ? t('billing.quantityError') : undefined}
          >
            <Input
              id="es-qty"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="tabular"
            />
          </Field>
          <Field
            label={t('billing.col.taxRate')}
            htmlFor="es-tax"
            hint={
              defaultTaxRateBp !== undefined
                ? t('billing.taxDefaultHint', { rate: formatRate(defaultTaxRateBp, locale) })
                : undefined
            }
            error={!taxOk ? t('billing.rateError') : undefined}
          >
            <Input
              id="es-tax"
              inputMode="decimal"
              value={taxRate}
              placeholder={percentInput(defaultTaxRateBp)}
              onChange={(e) => setTaxRate(e.target.value)}
            />
          </Field>
          <Field
            label={t('billing.col.nextBilling')}
            htmlFor="es-next"
            hint={
              service.interval === 'once' ? t('billing.service.nextOnceHint') : t('billing.service.nextHint')
            }
          >
            <Input
              id="es-next"
              type="date"
              value={nextBillingAt}
              onChange={(e) => setNextBillingAt(e.target.value)}
            />
          </Field>
          <Field label={t('billing.col.notes')} htmlFor="es-notes" className="sm:col-span-2">
            <Textarea
              id="es-notes"
              rows={2}
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        </div>
      )}
    </Dialog>
  );
}

/** Cancel a service, optionally switching its module off for the customer. */
export function CancelServiceDialog({
  service,
  onOpenChange,
}: {
  service: ServiceDto | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const labels = useBillingLabels();
  const [endsAt, setEndsAt] = useState(todayISO());
  const [deactivate, setDeactivate] = useState(false);
  useEffect(() => {
    if (!service) return;
    setEndsAt(todayISO());
    setDeactivate(false);
  }, [service]);

  const cancel = useApiMutation(
    () =>
      api.post<ServiceDto>(`/services/${service!.id}/cancel`, {
        endsAt: endsAt || undefined,
        deactivateModule: deactivate,
      }),
    {
      success: (s) => t('billing.service.cancelled', { name: s.name }),
      invalidate: moduleChangeKeys,
      onSuccess: () => onOpenChange(false),
    },
  );

  return (
    <Dialog
      open={!!service}
      onOpenChange={onOpenChange}
      size="sm"
      title={t('billing.service.cancelTitle', { name: service?.name ?? '' })}
      description={t('billing.service.cancelText')}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={!endsAt}
            loading={cancel.isPending}
            onClick={() => cancel.mutate(undefined)}
          >
            {t('billing.service.cancel')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label={t('billing.service.endsAt.label')}
          htmlFor="cs-ends"
          hint={t('billing.service.endsAtHint')}
        >
          <Input id="cs-ends" type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </Field>
        {service?.module && (
          <SwitchRow
            label={t('billing.service.deactivateModule', { module: labels.module(service.module) })}
            hint={t('billing.service.deactivateModuleHint')}
            checked={deactivate}
            onCheckedChange={setDeactivate}
          />
        )}
      </div>
    </Dialog>
  );
}

/** "Fällige Dienste abrechnen": one invoice with every service due until a date. */
export function GenerateDialog({
  open,
  onOpenChange,
  customer,
  onGenerated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: Customer;
  onGenerated: (invoiceId: string) => void;
}) {
  const { t } = useI18n();
  const [until, setUntil] = useState(todayISO());
  const [finalize, setFinalize] = useState(false);
  useEffect(() => {
    if (!open) return;
    setUntil(todayISO());
    setFinalize(false);
  }, [open]);

  const generate = useApiMutation(
    () =>
      api.post<GenerateResult>(`/billing/customers/${customer.org.id}/invoices/generate`, {
        until,
        finalize,
      }),
    {
      invalidate: [billingKeys.all],
      onSuccess: (result) => {
        const skipped = result.skipped ?? [];
        const currency = skipped.filter((s) => s.reason === 'currency');
        const amount = skipped.filter((s) => s.reason === 'amount');
        if (currency.length) {
          toast.warning(
            t('billing.generate.skipped', {
              names: currency.map((s) => `${s.name} (${s.currency})`).join(', '),
            }),
          );
        }
        if (amount.length) {
          toast.warning(t('billing.generate.skippedAmount', { names: amount.map((s) => s.name).join(', ') }));
        }
        if (result.invoice) {
          toast.success(
            result.invoice.number
              ? t('billing.generate.doneFinal', { number: result.invoice.number })
              : t('billing.generate.done'),
          );
          onOpenChange(false);
          onGenerated(result.invoice.id);
        } else {
          toast.info(t('billing.generate.nothing'));
        }
      },
    },
  );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={t('billing.generate.title')}
      description={t('billing.generate.text')}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!until}
            loading={generate.isPending}
            onClick={() => generate.mutate(undefined)}
          >
            {t('billing.generate.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('billing.generate.until')} htmlFor="gen-until" hint={t('billing.generate.untilHint')}>
          <Input id="gen-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </Field>
        <SwitchRow
          label={t('billing.generate.finalize')}
          hint={t('billing.generate.finalizeHint')}
          checked={finalize}
          onCheckedChange={setFinalize}
        />
        {customer.org.status === 'suspended' && (
          <Notice tone="warning">{t('billing.generate.suspended')}</Notice>
        )}
      </div>
    </Dialog>
  );
}
