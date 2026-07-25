/* Diagrama de digitación, igual al que dibuja la app de alumnos (chords.js).
   Si el acorde no entra en los primeros trastes, la ventana se corre y se rotula
   la posición, como en cualquier diagrama de acordes. */

const STRINGS = ['G', 'C', 'E', 'A'];
const N_FRETS = 4;

interface Props {
  frets: number[];
  fingers: number[];
  /** Permite clic para cambiar el traste de una cuerda. */
  onFretChange?: (stringIndex: number, fret: number) => void;
  size?: number;
}

export function ChordDiagram({ frets, fingers, onFretChange, size = 118 }: Props) {
  const W = 200, H = 152;
  const left = 40, right = 160, top = 36, bottom = 136;
  const sSpace = (right - left) / (STRINGS.length - 1);
  const fSpace = (bottom - top) / N_FRETS;

  const pressed = frets.filter((f) => f > 0);
  const maxFret = pressed.length ? Math.max(...pressed) : 0;
  const base = maxFret > N_FRETS ? Math.min(...pressed) - 1 : 0;

  const lines = [];
  for (let f = 0; f <= N_FRETS; f++) {
    const y = top + f * fSpace;
    lines.push(
      <line
        key={'f' + f}
        x1={left} y1={y} x2={right} y2={y}
        stroke="#3A2A63" strokeWidth={f === 0 && base === 0 ? 4 : 1.4} strokeLinecap="round"
      />,
    );
  }
  for (let s = 0; s < STRINGS.length; s++) {
    const x = left + s * sSpace;
    lines.push(<line key={'s' + s} x1={x} y1={top} x2={x} y2={bottom} stroke="#3A2A63" strokeWidth={1.4} />);
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={size} xmlns="http://www.w3.org/2000/svg">
      {lines}
      {base > 0 && (
        <text x={left - 14} y={top + fSpace * 0.5} fill="#6B5A93" fontSize="11" fontWeight="800"
              textAnchor="middle" dominantBaseline="central">
          {base + 1}ª
        </text>
      )}

      {STRINGS.map((name, s) => {
        const x = left + s * sSpace;
        const fr = frets[s] ?? 0;
        const fg = fingers[s] ?? 0;
        return (
          <g key={name}>
            {fr === 0 ? (
              <circle cx={x} cy={20} r={6} fill="none" stroke="#6B5A93" strokeWidth={1.6} />
            ) : (
              <>
                <circle cx={x} cy={top + (fr - base - 0.5) * fSpace} r={10} fill="#FF5F7E" />
                {fg > 0 && (
                  <text x={x} y={top + (fr - base - 0.5) * fSpace} fill="#fff" fontSize="12" fontWeight="800"
                        textAnchor="middle" dominantBaseline="central">
                    {fg}
                  </text>
                )}
              </>
            )}
            <text x={x} y={150} fill="#6B5A93" fontSize="11" fontWeight="700" textAnchor="middle">
              {name}
            </text>

            {/* Zonas invisibles para tocar y cambiar el traste con el mouse */}
            {onFretChange &&
              Array.from({ length: N_FRETS + 1 }, (_, f) => (
                <rect
                  key={f}
                  x={x - sSpace / 2} y={f === 0 ? 6 : top + (f - 1) * fSpace}
                  width={sSpace} height={f === 0 ? top - 8 : fSpace}
                  fill="transparent" style={{ cursor: 'pointer' }}
                  onClick={() => onFretChange(s, f === 0 ? 0 : f + base)}
                />
              ))}
          </g>
        );
      })}
    </svg>
  );
}
