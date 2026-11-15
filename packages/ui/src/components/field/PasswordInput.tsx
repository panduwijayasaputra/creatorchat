import { useState, type InputHTMLAttributes, type Ref } from 'react';
import { EyeIcon } from '../../icons';
import styles from './Field.module.css';

export interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Points at the underlying input (React 19 passes `ref` as a prop). */
  ref?: Ref<HTMLInputElement>;
}

/**
 * Password field with the "Tampilkan" toggle from AdmLogin. The toggle's visible text and
 * accessible name change together ("Tampilkan password" / "Sembunyikan password").
 * "Sembunyikan" is not on any board; it is the natural opposite of the designed label.
 */
export function PasswordInput({ className, ...rest }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div
      className={[styles.control, styles.passwordWrap, className ?? ''].filter(Boolean).join(' ')}
    >
      <input {...rest} type={visible ? 'text' : 'password'} className={styles.bare} />
      <button
        type="button"
        className={styles.reveal}
        aria-label={visible ? 'Sembunyikan password' : 'Tampilkan password'}
        onClick={() => setVisible((v) => !v)}
      >
        <EyeIcon size={18} strokeWidth={2} />
        {visible ? 'Sembunyikan' : 'Tampilkan'}
      </button>
    </div>
  );
}
