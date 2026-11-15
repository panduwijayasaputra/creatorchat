import type { InputHTMLAttributes, Ref } from 'react';
import styles from './Field.module.css';

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  ref?: Ref<HTMLInputElement>;
}

export function TextInput({ className, ...rest }: TextInputProps) {
  return <input {...rest} className={[styles.input, className ?? ''].filter(Boolean).join(' ')} />;
}
