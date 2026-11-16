import styles from './Switch.module.css';

export interface SwitchProps {
  checked: boolean;
  /** Accessible name (the visible label sits next to the switch in the row). */
  label: string;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
}

/** 52x32 track in a 64x44 touch target (`Profile.html`, Notifikasi rows). */
export function Switch({ checked, label, onChange, disabled = false }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={styles.switch}
      onClick={() => onChange?.(!checked)}
    >
      <span className={[styles.track, checked ? styles.on : ''].filter(Boolean).join(' ')}>
        <span className={[styles.knob, checked ? styles.knobOn : ''].filter(Boolean).join(' ')} />
      </span>
    </button>
  );
}
