import { MAX_PLAYABLE_MIDI, MIN_PLAYABLE_MIDI, pitchToMidi } from '../lib/notation';
import type { BackingEvent } from '../lib/chartFormat';

interface Props {
  notes: BackingEvent[];
  pxPerBeat: number;
  totalBeats: number;
  cursorBeat: number | null;
}

/**
 * Tira de "piano roll" del acompañamiento: alto = altura de la nota.
 * Es solo para ver cómo se alinea con lo jugable — el fondo se importa, no se
 * dibuja a mano, así que no hace falta que sea editable.
 */
export function BackingLane({ notes, pxPerBeat, totalBeats, cursorBeat }: Props) {
  const width = totalBeats * pxPerBeat;

  const midis = notes.map((n) => pitchToMidi(n.pitch)).filter((m): m is number => m !== null);
  const lo = midis.length ? Math.min(...midis) : MIN_PLAYABLE_MIDI;
  const hi = midis.length ? Math.max(...midis) : MAX_PLAYABLE_MIDI;
  const span = Math.max(12, hi - lo); // al menos una octava, para que no se vea aplastado

  return (
    <div className="grid-wrap">
      <div className="grid-scroll" style={{ width }}>
        <div className="backing-lane" style={{ width }}>
          {notes.map((n, i) => {
            const midi = pitchToMidi(n.pitch);
            if (midi === null) return null;
            const y = 1 - (midi - lo) / span; // 0 arriba, 1 abajo
            return (
              <div
                key={i}
                className="bnote"
                style={{
                  left: n.t * pxPerBeat,
                  width: Math.max(n.dur * pxPerBeat - 2, 5),
                  top: `calc(6px + ${y} * (100% - 20px))`,
                }}
                title={`${n.pitch} · beat ${n.t} · ${n.dur} tiempo(s)`}
              />
            );
          })}
          {cursorBeat !== null && cursorBeat >= 0 && cursorBeat <= totalBeats && (
            <div className="cursor-line" style={{ left: cursorBeat * pxPerBeat }} />
          )}
        </div>
      </div>
    </div>
  );
}
