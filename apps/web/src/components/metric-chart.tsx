import { useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
  type TooltipValueType,
} from 'recharts';
import { BarChart3, Table2 } from 'lucide-react';
import type { MetricPoint, MetricRange } from '@weblion/shared';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { Card, EmptyState } from './ui/primitives';
import { Table, TBody, TD, TH, THead } from './ui/table';

export interface SeriesDef {
  key: keyof Omit<MetricPoint, 't'>;
  label: string;
  /** Categorical slot, see --series-N in styles.css. Assigned in fixed order. */
  slot: 1 | 2;
}

/** Reads chart colors from CSS tokens and follows theme switches. */
function useChartTokens() {
  const read = () => {
    const css = getComputedStyle(document.documentElement);
    const v = (name: string) => css.getPropertyValue(name).trim();
    return {
      series: { 1: v('--series-1'), 2: v('--series-2') } as Record<1 | 2, string>,
      grid: v('--chart-grid'),
      axis: v('--chart-axis'),
      muted: v('--text-subtle'),
      surface: v('--surface'),
    };
  };
  const [tokens, setTokens] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setTokens(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return tokens;
}

function tickFormatter(range: MetricRange, locale: string) {
  const intl = locale === 'de' ? 'de-CH' : 'en-GB';
  const opts: Intl.DateTimeFormatOptions =
    range === 'hour' || range === 'day'
      ? { hour: '2-digit', minute: '2-digit' }
      : range === 'year'
        ? { month: 'short', year: '2-digit' }
        : { day: '2-digit', month: '2-digit' };
  const fmt = new Intl.DateTimeFormat(intl, opts);
  return (t: number) => fmt.format(new Date(t * 1000));
}

function fullTime(t: number, locale: string) {
  return new Intl.DateTimeFormat(locale === 'de' ? 'de-CH' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(t * 1000));
}

export function MetricChart({
  title,
  subtitle,
  points,
  series,
  format,
  range,
  fetching,
  yDomain,
}: {
  title: string;
  subtitle?: string;
  points: MetricPoint[];
  series: SeriesDef[];
  format: (value: number) => string;
  range: MetricRange;
  fetching?: boolean;
  yDomain?: [number, number | 'auto'];
}) {
  const { t, locale } = useI18n();
  const tokens = useChartTokens();
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const hasData = points.some((p) => series.some((s) => typeof p[s.key] === 'number'));
  const xFmt = tickFormatter(range, locale);
  const latest = [...points].reverse().find((p) => series.some((s) => typeof p[s.key] === 'number'));

  const renderTooltip = ({
    active,
    payload,
    label,
  }: TooltipContentProps<TooltipValueType, string | number>) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="min-w-[160px] rounded-lg border border-border bg-surface px-3 py-2 shadow-pop">
        <div className="mb-1.5 text-xs text-muted">{fullTime(Number(label), locale)}</div>
        {series.map((s) => {
          const value = payload.find((p) => p.dataKey === s.key)?.value;
          return (
            <div key={s.key} className="flex items-center gap-2 py-0.5 text-sm">
              <span className="h-0.5 w-3 rounded-full" style={{ background: tokens.series[s.slot] }} />
              <span className="font-semibold text-text tabular">
                {typeof value === 'number' ? format(value) : '–'}
              </span>
              <span className="text-muted">{s.label}</span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-text">{title}</h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
            {subtitle && <span>{subtitle}</span>}
            {/* Legend for two or more series; one series is named by the title. */}
            {series.length > 1 &&
              series.map((s) => (
                <span key={s.key} className="inline-flex items-center gap-1.5">
                  <span className="h-0.5 w-3.5 rounded-full" style={{ background: tokens.series[s.slot] }} />
                  {s.label}
                  {latest && typeof latest[s.key] === 'number' && (
                    <span className="font-medium text-text tabular">{format(latest[s.key] as number)}</span>
                  )}
                </span>
              ))}
            {series.length === 1 && latest && typeof latest[series[0]!.key] === 'number' && (
              <span>
                {t('graphs.current')}{' '}
                <span className="font-medium text-text tabular">
                  {format(latest[series[0]!.key] as number)}
                </span>
              </span>
            )}
          </div>
        </div>
        <div
          className="flex rounded-lg border border-border p-0.5"
          role="group"
          aria-label={t('graphs.view')}
        >
          {(['chart', 'table'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn('rounded-md p-1.5 text-muted', view === v && 'bg-surface-3 text-text')}
              aria-pressed={view === v}
              aria-label={v === 'chart' ? t('graphs.asChart') : t('graphs.asTable')}
              title={v === 'chart' ? t('graphs.asChart') : t('graphs.asTable')}
            >
              {v === 'chart' ? <BarChart3 className="size-4" /> : <Table2 className="size-4" />}
            </button>
          ))}
        </div>
      </div>
      <div className={cn('px-2 pt-2 pb-3 transition-opacity', fetching && 'opacity-60')}>
        {!hasData ? (
          <EmptyState title={t('graphs.noData')} className="py-12" />
        ) : view === 'chart' ? (
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ top: 8, right: 16, bottom: 0, left: 4 }}>
                <CartesianGrid vertical={false} stroke={tokens.grid} strokeWidth={1} />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={xFmt}
                  tick={{ fill: tokens.muted, fontSize: 11 }}
                  axisLine={{ stroke: tokens.axis }}
                  tickLine={false}
                  minTickGap={40}
                />
                <YAxis
                  tickFormatter={(v: number) => format(v)}
                  tick={{ fill: tokens.muted, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={72}
                  domain={yDomain ?? [0, 'auto']}
                  allowDecimals
                />
                <Tooltip
                  content={renderTooltip}
                  cursor={{ stroke: tokens.axis, strokeWidth: 1 }}
                  isAnimationActive={false}
                />
                {series.map((s) => (
                  <Area
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    name={s.label}
                    stroke={tokens.series[s.slot]}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill={tokens.series[s.slot]}
                    fillOpacity={0.1}
                    dot={false}
                    activeDot={{ r: 4, fill: tokens.series[s.slot], stroke: tokens.surface, strokeWidth: 2 }}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="max-h-[220px] overflow-y-auto px-3">
            <Table>
              <THead>
                <tr>
                  <TH>{t('graphs.time')}</TH>
                  {series.map((s) => (
                    <TH key={s.key} className="text-right">
                      {s.label}
                    </TH>
                  ))}
                </tr>
              </THead>
              <TBody>
                {[...points].reverse().map((p) => (
                  <tr key={p.t}>
                    <TD className="py-1.5 text-muted tabular">{fullTime(p.t, locale)}</TD>
                    {series.map((s) => (
                      <TD key={s.key} className="py-1.5 text-right tabular">
                        {typeof p[s.key] === 'number' ? format(p[s.key] as number) : '–'}
                      </TD>
                    ))}
                  </tr>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </div>
    </Card>
  );
}
