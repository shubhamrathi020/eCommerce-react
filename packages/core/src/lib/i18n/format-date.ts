/**
 * Formats a date with the small pattern language the shop's screens use (the subset of Angular's `date` pipe in use):
 *   d dd  day · M MM MMM MMMM  month · y yyyy  year · EEE EEEE  weekday · h hh  hour (12h) · H HH  hour (24h) · mm  minutes · a  AM/PM
 * Names come from Intl, so they follow the language. Text inside single quotes is copied as is.
 */
export function formatDate(value: Date | string | number, pattern: string, locale: string, timeZone?: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid date');
  const part = (opts: Intl.DateTimeFormatOptions, type: Intl.DateTimeFormatPartTypes): string =>
    new Intl.DateTimeFormat(locale, { ...opts, timeZone }).formatToParts(date).find((p) => p.type === type)?.value ?? '';
  const num = (opts: Intl.DateTimeFormatOptions, type: Intl.DateTimeFormatPartTypes): string => part({ ...opts, numberingSystem: 'latn' } as Intl.DateTimeFormatOptions, type);
  const pad = (s: string, n: number) => s.padStart(n, '0');
  const hour24 = Number(num({ hour: 'numeric', hourCycle: 'h23' }, 'hour'));

  const tokens: Record<string, () => string> = {
    dd: () => pad(num({ day: 'numeric' }, 'day'), 2),
    d: () => num({ day: 'numeric' }, 'day'),
    MMMM: () => part({ month: 'long' }, 'month'),
    MMM: () => part({ month: 'short' }, 'month'),
    MM: () => pad(num({ month: 'numeric' }, 'month'), 2),
    M: () => num({ month: 'numeric' }, 'month'),
    yyyy: () => num({ year: 'numeric' }, 'year'),
    y: () => num({ year: 'numeric' }, 'year'),
    EEEE: () => part({ weekday: 'long' }, 'weekday'),
    EEE: () => part({ weekday: 'short' }, 'weekday'),
    HH: () => pad(String(hour24), 2),
    H: () => String(hour24),
    hh: () => pad(String(hour24 % 12 === 0 ? 12 : hour24 % 12), 2),
    h: () => String(hour24 % 12 === 0 ? 12 : hour24 % 12),
    mm: () => pad(num({ minute: 'numeric' }, 'minute'), 2),
    a: () => part({ hour: 'numeric', hour12: true }, 'dayPeriod'),
  };
  const order = Object.keys(tokens).sort((a, b) => b.length - a.length);

  let out = '';
  for (let i = 0; i < pattern.length; ) {
    if (pattern[i] === "'") {
      const end = pattern.indexOf("'", i + 1);
      const stop = end === -1 ? pattern.length : end;
      out += pattern.slice(i + 1, stop);
      i = stop + 1;
      continue;
    }
    const hit = order.find((t) => pattern.startsWith(t, i));
    if (hit) {
      out += tokens[hit]();
      i += hit.length;
    } else {
      out += pattern[i];
      i++;
    }
  }
  return out;
}
