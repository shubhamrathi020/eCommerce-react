import { describe, expect, it } from 'vitest';
import { Injector } from '../../runtime';
import { MemoryStorage, STORAGE } from '../tokens';
import { formatDate } from './format-date';
import { I18nService } from './i18n.service';
import { formatMessage } from './message-format';

describe('message format', () => {
  it('fills values and chooses plural forms for the language', () => {
    expect(formatMessage('Hi {name}', { name: 'Asha' }, 'en-IN')).toBe('Hi Asha');
    const tpl = '{count, plural, one {# item} other {# items}}';
    expect(formatMessage(tpl, { count: 1 }, 'en-IN')).toBe('1 item');
    expect(formatMessage(tpl, { count: 3 }, 'en-IN')).toBe('3 items');
  });
});

describe('date format', () => {
  const d = new Date(2026, 9, 5, 15, 7); // 5 Oct 2026, 15:07 local time
  it('renders the patterns the screens use', () => {
    expect(formatDate(d, 'd MMM y', 'en-US')).toBe('5 Oct 2026');
    expect(formatDate(d, 'd MMM y, h:mm a', 'en-US')).toBe('5 Oct 2026, 3:07 PM');
    expect(formatDate(d, 'EEE, d MMM', 'en-US')).toBe('Mon, 5 Oct');
    expect(formatDate(d, 'MMM y', 'en-US')).toBe('Oct 2026');
    expect(formatDate(d, "d MMM 'at' HH:mm", 'en-US')).toBe('5 Oct at 15:07');
  });
  it('uses the language for month names', () => {
    expect(formatDate(d, 'MMMM', 'hi')).toBe('अक्टूबर');
  });
});

describe('I18nService', () => {
  const make = () => new Injector([{ provide: STORAGE, useValue: new MemoryStorage() }]).get(I18nService);

  it('switches every string, the page direction and the date and number formats', () => {
    const i18n = make();
    expect(i18n.t('common.tryAgain')).toBe('Try again');
    const english = i18n.t('footer.newsletter');
    i18n.set('hi');
    expect(i18n.locale()).toBe('hi');
    expect(document.documentElement.lang).toBe('hi');
    expect(i18n.t('footer.newsletter')).not.toBe(english);
    expect(i18n.date(new Date(2026, 9, 5), 'MMMM')).toBe('अक्टूबर');
    i18n.set('en');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('falls back to the key itself so a gap is visible rather than blank, and remembers the choice', () => {
    const storage = new MemoryStorage();
    const first = new Injector([{ provide: STORAGE, useValue: storage }]).get(I18nService);
    expect(first.t('no.such.key')).toBe('no.such.key');
    first.set('hi');
    expect(new Injector([{ provide: STORAGE, useValue: storage }]).get(I18nService).locale()).toBe('hi');
  });
});
