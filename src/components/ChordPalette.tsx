import { chordColor } from '../lib/colors';
import { dedosDeLaForma } from '../lib/dificultad';
import type { ChordRow } from '../lib/db';

interface Props {
  chords: ChordRow[];
  selected: string | null;
  /** Los que el sub-nivel actual deja usar. Los demás se pueden poner igual, avisando. */
  permitidos?: string[];
  onSelect: (id: string) => void;
}

/**
 * Paleta con los acordes leídos de la tabla `chords`.
 *
 * Los que quedan fuera del sub-nivel no se esconden ni se bloquean: el autor
 * puede tener un motivo. Se marcan, y el medidor de dificultad avisa después.
 * Cada uno muestra cuántos dedos pide, que es lo que de verdad lo hace difícil.
 */
export function ChordPalette({ chords, selected, permitidos, onSelect }: Props) {
  if (chords.length === 0) {
    return <p className="muted">No hay acordes cargados en la base.</p>;
  }
  const deja = permitidos ? new Set(permitidos) : null;
  const hayFuera = deja ? chords.some((c) => !deja.has(c.id)) : false;

  return (
    <>
      <div className="palette">
        {chords.map((c) => {
          const col = chordColor(c.id);
          const fuera = deja ? !deja.has(c.id) : false;
          const dedos = dedosDeLaForma(c.frets);
          return (
            <button
              key={c.id}
              type="button"
              className={'chip' + (selected === c.id ? ' sel' : '') + (fuera ? ' fuera' : '')}
              style={{ background: col.bg, boxShadow: `0 5px 0 ${col.shadow}` }}
              onClick={() => onSelect(c.id)}
              title={
                `${c.name_es} · trastes ${c.frets.join('-')} · ${dedos} ${dedos === 1 ? 'dedo' : 'dedos'}` +
                (fuera ? ' · fuera de este sub-nivel' : '')
              }
            >
              {c.id}
              <small>
                {'●'.repeat(dedos) || 'al aire'}
              </small>
            </button>
          );
        })}
      </div>
      {hayFuera && (
        <p className="muted" style={{ margin: '8px 0 0' }}>
          Los acordes en gris quedan <b>fuera de este sub-nivel</b> (piden más dedos). Podés usarlos
          igual: el medidor de abajo te avisa si te pasaste.
        </p>
      )}
    </>
  );
}
