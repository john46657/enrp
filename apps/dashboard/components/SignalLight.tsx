import type { StatusTone } from './StatusBadge';

/**
 * Das "Leuchtfeuer": große Statusleuchte für den Zustand des Backends.
 * Die Leuchte ist rein dekorativ – die Aussage steht immer im Text daneben.
 */
export function SignalLight({ tone }: { tone: StatusTone }) {
  return (
    <div className={`signal signal--${tone}`} aria-hidden="true">
      <span className="signal__lamp" />
    </div>
  );
}
