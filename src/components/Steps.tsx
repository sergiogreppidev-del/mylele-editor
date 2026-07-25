export interface Step {
  id: string;
  label: string;
  /** true = tiene errores que hay que resolver antes de publicar. */
  problema?: boolean;
}

interface Props {
  steps: Step[];
  current: string;
  onGo: (id: string) => void;
}

/**
 * Barra de pasos. Es CLICKEABLE a propósito: guía a quien recién empieza, pero
 * para un cambio chico (mover un acorde y republicar) se salta directo al paso
 * que hace falta, sin navegar en fila.
 */
export function Steps({ steps, current, onGo }: Props) {
  const idx = steps.findIndex((s) => s.id === current);
  return (
    <nav className="steps" aria-label="Pasos">
      {steps.map((s, i) => {
        const estado = s.id === current ? 'on' : i < idx ? 'done' : '';
        return (
          <button
            key={s.id}
            type="button"
            className={`wstep ${estado}${s.problema ? ' bad' : ''}`}
            onClick={() => onGo(s.id)}
            aria-current={s.id === current ? 'step' : undefined}
          >
            <span className="wstep-n">{s.problema ? '!' : i < idx ? '✓' : i + 1}</span>
            <span className="wstep-l">{s.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
