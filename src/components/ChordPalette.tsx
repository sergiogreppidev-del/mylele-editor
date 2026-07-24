import { chordColor } from '../lib/colors';
import type { ChordRow } from '../lib/db';

interface Props {
  chords: ChordRow[];
  selected: string | null;
  onSelect: (id: string) => void;
}

/** Paleta lateral con los acordes leídos de la tabla `chords`. */
export function ChordPalette({ chords, selected, onSelect }: Props) {
  if (chords.length === 0) {
    return <p className="muted">No hay acordes cargados en la base.</p>;
  }
  return (
    <div className="palette">
      {chords.map((c) => {
        const col = chordColor(c.id);
        return (
          <button
            key={c.id}
            type="button"
            className={'chip' + (selected === c.id ? ' sel' : '')}
            style={{ background: col.bg, boxShadow: `0 5px 0 ${col.shadow}` }}
            onClick={() => onSelect(c.id)}
            title={`${c.name_es} · trastes ${c.frets.join('-')}`}
          >
            {c.id}
            <small>{c.name_es}</small>
          </button>
        );
      })}
    </div>
  );
}
