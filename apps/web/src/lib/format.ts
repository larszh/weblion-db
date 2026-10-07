export type Locale = 'de' | 'en';

const intlLocale = (locale: Locale) => (locale === 'de' ? 'de-CH' : 'en-GB');

export function formatBytes(bytes: number | null | undefined, decimals = 1): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '–';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value.toFixed(i === 0 ? 0 : value < 10 ? decimals : 0)} ${units[i]}`;
}

export function formatRate(bytesPerSecond: number | null | undefined): string {
  if (bytesPerSecond === null || bytesPerSecond === undefined) return '–';
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatMemoryMb(mb: number | null | undefined): string {
  if (mb === null || mb === undefined) return '–';
  return mb >= 1024 ? `${Number.isInteger(mb / 1024) ? mb / 1024 : (mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  return `${value.toFixed(digits)} %`;
}

export function formatDate(
  value: string | number | Date | null | undefined,
  locale: Locale,
  withTime = true,
): string {
  if (!value) return '–';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '–';
  return new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' } : {}),
  }).format(d);
}

export function formatRelative(value: string | number | Date | null | undefined, locale: Locale): string {
  if (!value) return '–';
  const d = value instanceof Date ? value : new Date(value);
  const diff = (d.getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 30 * 86_400) return rtf.format(Math.round(diff / 86_400), 'day');
  return formatDate(d, locale, false);
}

export function formatDuration(seconds: number | null | undefined, locale: Locale): string {
  if (seconds === null || seconds === undefined) return '–';
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const days = locale === 'de' ? 'T' : 'd';
  if (d > 0) return `${d}${days} ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale)).format(value);
}
