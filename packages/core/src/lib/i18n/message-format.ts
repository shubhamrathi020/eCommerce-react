/**
 * A small message format for translations (BRD 18, LX-01): `{name}` fills in a value and
 * `{count, plural, one {# item} other {# items}}` picks a plural form by the locale's own rules (`#` is the number).
 * Messages are never glued together from pieces; word order and plurals live inside one translatable string.
 */

export type MessageParams = Record<string, string | number | null | undefined>;
type Params = MessageParams;

const rules = new Map<string, Intl.PluralRules>();
const numbers = new Map<string, Intl.NumberFormat>();
const pluralRules = (locale: string) => rules.get(locale) ?? (rules.set(locale, new Intl.PluralRules(locale)), rules.get(locale) as Intl.PluralRules);
const numberFormat = (locale: string) => numbers.get(locale) ?? (numbers.set(locale, new Intl.NumberFormat(locale)), numbers.get(locale) as Intl.NumberFormat);

/** Index of the `}` that closes the `{` at `open`, allowing nested braces. -1 when unbalanced. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** `one {# item} other {# items}` into `{ one: '# item', other: '# items' }`. */
function branches(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < body.length) {
    const open = body.indexOf('{', i);
    if (open < 0) break;
    const key = body.slice(i, open).trim();
    const end = closing(body, open);
    if (end < 0) break;
    out[key] = body.slice(open + 1, end);
    i = end + 1;
  }
  return out;
}

export function formatMessage(template: string, params: Params = {}, locale = 'en'): string {
  let out = '';
  let i = 0;
  while (i < template.length) {
    const ch = template[i];
    if (ch !== '{') {
      out += ch;
      i += 1;
      continue;
    }
    const end = closing(template, i);
    if (end < 0) return out + template.slice(i); // unbalanced: show the rest as written rather than throw
    const inner = template.slice(i + 1, end);
    const plural = inner.match(/^\s*(\w+)\s*,\s*plural\s*,([\s\S]*)$/);
    if (plural) {
      const count = Number(params[plural[1]] ?? 0);
      const forms = branches(plural[2]);
      const pick = forms[`=${count}`] ?? forms[pluralRules(locale).select(count)] ?? forms['other'] ?? '';
      out += formatMessage(pick.replace(/#/g, numberFormat(locale).format(count)), params, locale);
    } else {
      const value = params[inner.trim()];
      out += value === undefined ? '' : String(value);
    }
    i = end + 1;
  }
  return out;
}
