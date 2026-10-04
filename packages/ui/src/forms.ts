import { useCallback, useMemo, useState } from 'react';

/** A rule gets the field's text and returns a message when it is not acceptable, or '' when it is. */
export type Rule = (value: string) => string;

/** Password rule shown next to new-password fields (mirrors the server rule). */
export const PASSWORD_HINT = 'At least 8 characters with upper case, lower case and a number.';

export const rules = {
  required:
    (message = 'This field is required'): Rule =>
    (v) =>
      v.trim() ? '' : message,
  email:
    (message = 'Enter a valid email address'): Rule =>
    (v) =>
      !v.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? '' : message,
  pattern:
    (re: RegExp, message = 'Enter a valid value'): Rule =>
    (v) =>
      !v || re.test(v) ? '' : message,
  minLength:
    (n: number, message = `Use at least ${n} characters.`): Rule =>
    (v) =>
      !v || v.length >= n ? '' : message,
  /** Runs the rules in order and reports the first problem. */
  all:
    (...list: Rule[]): Rule =>
    (v) => {
      for (const rule of list) {
        const problem = rule(v);
        if (problem) return problem;
      }
      return '';
    },
};

export interface Form<K extends string> {
  values: Record<K, string>;
  /** Message to show under a field: the server's answer wins, otherwise the rule's, but only once the field was touched. */
  error: (name: K) => string;
  /** Props for a text input: `<input {...form.bind('email')} />`. */
  bind: (name: K) => { name: K; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void; onBlur: () => void };
  set: (name: K, value: string) => void;
  patch: (values: Partial<Record<K, string>>) => void;
  /** Marks everything touched and reports whether every rule passes. */
  validate: () => boolean;
  /** The first field whose rule fails, to move focus to. */
  firstInvalid: () => K | undefined;
  setServerErrors: (errors: Record<string, string>) => void;
  reset: (values?: Record<K, string>) => void;
}

/** Small controlled-form helper: values, touched state, per-field rules and server-side field errors. */
export function useForm<K extends string>(initial: Record<K, string>, fieldRules: Partial<Record<K, Rule>> = {}): Form<K> {
  const [values, setValues] = useState<Record<K, string>>(initial);
  const [touched, setTouched] = useState<ReadonlySet<K>>(new Set());
  const [server, setServer] = useState<Record<string, string>>({});
  const keys = useMemo(() => Object.keys(initial) as K[], [initial]);

  const problem = (name: K, v = values): string => fieldRules[name]?.(v[name]) ?? '';

  const set = useCallback((name: K, value: string) => {
    setValues((v) => ({ ...v, [name]: value }));
    // Typing clears the server's complaint about that field.
    setServer((s) => (s[name] ? { ...s, [name]: '' } : s));
  }, []);

  return {
    values,
    error: (name) => server[name] || (touched.has(name) ? problem(name) : ''),
    bind: (name) => ({
      name,
      value: values[name],
      onChange: (e) => set(name, e.target.value),
      onBlur: () => setTouched((t) => new Set(t).add(name)),
    }),
    set,
    patch: (patch) => setValues((v) => ({ ...v, ...patch })),
    validate: () => {
      setServer({});
      setTouched(new Set(keys));
      return keys.every((k) => !problem(k));
    },
    firstInvalid: () => keys.find((k) => problem(k)),
    setServerErrors: setServer,
    reset: (next) => {
      setValues(next ?? initial);
      setTouched(new Set());
      setServer({});
    },
  };
}
