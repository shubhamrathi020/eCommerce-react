import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { FormField, cx, inputClass } from './basics';
import type { Form } from './forms';

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'form' | 'name' | 'value' | 'onChange' | 'onBlur'>;
type AreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'form' | 'name' | 'value' | 'onChange' | 'onBlur'>;

/** A labelled text input (or textarea with `rows`) bound to a `useForm` field, with its validation message. */
export function TextField<K extends string>({
  form,
  name,
  label,
  required = false,
  hint = '',
  className,
  rows,
  ...input
}: { form: Form<K>; name: K; label: string; required?: boolean; hint?: string; className?: string; rows?: number } & InputProps & AreaProps) {
  const error = form.error(name);
  const bound = form.bind(name);
  return (
    <div className={className}>
      <FormField label={label} required={required} error={error} hint={hint}>
        {(f) =>
          rows ? (
            <textarea id={f.id} className={inputClass} rows={rows} aria-describedby={f.describedBy} aria-invalid={error ? 'true' : undefined} {...bound} {...(input as AreaProps)} />
          ) : (
            <input id={f.id} className={inputClass} aria-describedby={f.describedBy} aria-invalid={error ? 'true' : undefined} {...bound} {...(input as InputProps)} />
          )
        }
      </FormField>
    </div>
  );
}

/** A native select with a visible label and the shared input styling. */
export function SelectField({ id, label, value, onChange, className, children }: { id: string; label: string; value: string; onChange: (value: string) => void; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-text">
        {label}
      </label>
      <select id={id} className={cx(inputClass)} value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </div>
  );
}

/** A red-bordered alert box for form-level problems. */
export function FormError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p className="mb-4 rounded-md border border-danger p-3 text-sm" role="alert">
      {children}
    </p>
  );
}
