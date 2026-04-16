import { DEFAULT_DAY_ROLLOVER_TIMEZONE } from '../constants';

export function resolveDayRolloverTimezone(rawValue: string | undefined): string {
  const normalized = rawValue?.trim();
  return normalized || DEFAULT_DAY_ROLLOVER_TIMEZONE;
}

export function formatDayInTimeZone(date: Date, timeZone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    if (!year || !month || !day) {
      return formatUtcDay(date);
    }
    return `${year}-${month}-${day}`;
  } catch {
    return formatUtcDay(date);
  }
}

export function formatUtcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function formatUtcMinute(date: Date): string {
  return date.toISOString().slice(0, 16);
}
