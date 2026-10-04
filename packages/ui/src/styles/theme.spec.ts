import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Colour contrast for both themes (BRD 18, LX-04): every text/background pair the UI actually uses must reach WCAG AA
 * (4.5:1 for text, 3:1 for the borders that mark a control). The values are read from theme.css itself, so editing a token
 * that breaks contrast fails here.
 */
const css = readFileSync(resolve(import.meta.dirname, 'theme.css'), 'utf8');

function vars(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2].toLowerCase()]));
}

/** The text between the `{` after `start` and its matching `}`. */
function blockAfter(start: string): string {
  const at = css.indexOf(start);
  if (at < 0) throw new Error(`theme.css has no ${start}`);
  const open = css.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error('unbalanced');
}

const light = vars(blockAfter('@theme'));
const explicitDark = { ...light, ...vars(blockAfter(":root[data-theme='dark']")) };
const systemDark = { ...light, ...vars(blockAfter(":root:not([data-theme='light'])")) };

const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** [foreground token, background token, minimum ratio, where it is used] */
const PAIRS: [string, string, number, string][] = [
  ['text', 'bg', 4.5, 'body text'],
  ['text', 'surface', 4.5, 'text on cards'],
  ['text', 'surface-alt', 4.5, 'text on tinted panels'],
  ['text-muted', 'bg', 4.5, 'secondary text'],
  ['text-muted', 'surface', 4.5, 'secondary text on cards'],
  ['text-muted', 'surface-alt', 4.5, 'secondary text on panels'],
  ['primary', 'bg', 4.5, 'links'],
  ['primary', 'surface', 4.5, 'links on cards'],
  ['primary', 'surface-alt', 4.5, 'links on panels'],
  ['primary-contrast', 'primary', 4.5, 'primary buttons'],
  ['primary-contrast', 'primary-hover', 4.5, 'primary buttons on hover'],
  ['on-status', 'success', 4.5, 'success badges'],
  ['on-status', 'warning', 4.5, 'warning badges and the offline banner'],
  ['on-status', 'danger', 4.5, 'danger buttons and badges'],
  ['on-status', 'sale', 4.5, 'sale badges and the cart count'],
  ['success', 'bg', 4.5, 'success text'],
  ['success', 'surface-alt', 4.5, 'success text on panels'],
  ['warning', 'bg', 4.5, 'warning text'],
  ['danger', 'bg', 4.5, 'error text'],
  ['danger', 'surface', 4.5, 'error text on cards'],
  ['sale', 'bg', 4.5, 'sale text'],
  ['info', 'bg', 4.5, 'info text'],
  ['border-strong', 'bg', 3, 'input and control borders'],
  ['border-strong', 'surface', 3, 'control borders on cards'],
];

describe.each([
  ['light', light],
  ['dark (chosen)', explicitDark],
  ['dark (from the device setting)', systemDark],
])('%s theme contrast', (_name, tokens) => {
  it.each(PAIRS)('%s on %s reaches %s:1 (%s)', (fg, bg, min) => {
    expect(tokens[fg], `--color-${fg}`).toBeDefined();
    expect(tokens[bg], `--color-${bg}`).toBeDefined();
    expect(ratio(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(min);
  });
});

describe('dark theme definition', () => {
  it('is identical whether chosen by the visitor or taken from the device', () => {
    expect(systemDark).toEqual(explicitDark);
  });

  it('really is dark: a dark page background and light text', () => {
    expect(luminance(explicitDark['bg'])).toBeLessThan(0.05);
    expect(luminance(explicitDark['text'])).toBeGreaterThan(0.8);
  });

  it('lets an explicit light choice win over a dark device setting', () => {
    expect(css).toContain(":root:not([data-theme='light'])");
  });
});
