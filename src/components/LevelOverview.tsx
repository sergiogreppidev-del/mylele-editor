import { beatsPerBar } from '../lib/chartFormat';
import type { BackingEvent, ChordEvent, MelodyEvent } from '../lib/chartFormat';
import { MAX_PLAYABLE_MIDI, MIN_PLAYABLE_MIDI, STRING_MIDI, pitchToMidi } from '../lib/notation';
import { chordColor } from '../lib/colors';
import { STRING_COLORS } from './MelodyGrid';

interface Props {
  chords: ChordEvent[];
  melody: MelodyEvent[];
  backing: BackingEvent[];
  timeSig: string;
  pxPerBeat: number;
  bars: number;
  cursorBeat: number | null;
}

const H_ACORDES = 30;
const H_MELODIA = 46;
const H_FONDO = 52;

/**
 * Las tres capas alineadas en la misma línea de tiempo.
 *
 * Generar un nivel entero con una IA es rápido; darse cuenta de que la armonía
 * no calza con la melodía en el compás 7 no lo es. Esta vista existe para que
 * ese desfasaje se vea de un vistazo en vez de tener que escuchar todo.
 */
export function LevelOverview({ chords, melody, backing, timeSig, pxPerBeat, bars, cursorBeat }: Props) {
  const bpb = beatsPerBar(timeSig);
  const totalBeats = bars * bpb;
  const width = totalBeats * pxPerBeat;

  const midisFondo = backing.map((n) => pitchToMidi(n.pitch)).filter((m): m is number => m !== null);
  const lo = midisFondo.length ? Math.min(...midisFondo) : MIN_PLAYABLE_MIDI;
  const hi = midisFondo.length ? Math.max(...midisFondo) : MAX_PLAYABLE_MIDI;
  const span = Math.max(12, hi - lo);

  const lineas = [];
  for (let b = 1; b < totalBeats; b++) {
    lineas.push(
      <div key={b} className={'beat-line' + (b % bpb === 0 ? ' bar' : '')} style={{ left: b * pxPerBeat }} />,
    );
  }

  return (
    <div className="grid-wrap">
      <div className="grid-scroll" style={{ width: width + 62 }}>
        <div className="bar-ruler" style={{ marginLeft: 62 }}>
          {Array.from({ length: bars }, (_, i) => (
            <div key={i} className="bar" style={{ width: bpb * pxPerBeat }}>
              compás {i + 1}
            </div>
          ))}
        </div>

        <div className="ov-wrap">
          <div className="ov-labels">
            <div style={{ height: H_ACORDES }}>Acordes</div>
            <div style={{ height: H_MELODIA }}>Melodía</div>
            <div style={{ height: H_FONDO }}>Fondo</div>
          </div>

          <div className="ov-lanes" style={{ width, height: H_ACORDES + H_MELODIA + H_FONDO }}>
            {lineas}

            {/* Acordes */}
            {chords.map((e, i) => {
              const col = chordColor(e.chord);
              return (
                <div
                  key={'c' + i}
                  className="ov-chord"
                  style={{
                    left: e.t * pxPerBeat,
                    width: Math.max(e.dur * pxPerBeat - 2, 16),
                    background: col.bg,
                  }}
                  title={`${e.chord} · beat ${e.t}`}
                >
                  {e.chord}
                </div>
              );
            })}

            {/* Melodía, por cuerda */}
            {melody.map((e, i) => {
              const lane = ['G', 'C', 'E', 'A'].indexOf(e.string);
              if (lane < 0) return null;
              return (
                <div
                  key={'m' + i}
                  className="ov-note"
                  style={{
                    left: e.t * pxPerBeat,
                    width: Math.max(e.dur * pxPerBeat - 2, 6),
                    top: H_ACORDES + 5 + lane * 9,
                    background: STRING_COLORS[e.string].bg,
                  }}
                  title={`cuerda ${e.string} traste ${e.fret} · beat ${e.t}`}
                />
              );
            })}

            {/* Fondo, como piano roll */}
            {backing.map((n, i) => {
              const midi = pitchToMidi(n.pitch);
              if (midi === null) return null;
              const y = 1 - (midi - lo) / span;
              return (
                <div
                  key={'b' + i}
                  className="ov-back"
                  style={{
                    left: n.t * pxPerBeat,
                    width: Math.max(n.dur * pxPerBeat - 2, 5),
                    top: H_ACORDES + H_MELODIA + 5 + y * (H_FONDO - 14),
                  }}
                  title={`${n.pitch} · beat ${n.t}`}
                />
              );
            })}

            {cursorBeat !== null && cursorBeat >= 0 && cursorBeat <= totalBeats && (
              <div className="cursor-line" style={{ left: cursorBeat * pxPerBeat }} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** El largo de cada capa, para avisar cuando una no llega hasta el final. */
export function largoDeCapas(chords: ChordEvent[], melody: MelodyEvent[], backing: BackingEvent[]) {
  const fin = (l: { t: number; dur: number }[]) => l.reduce((m, e) => Math.max(m, e.t + e.dur), 0);
  return { acordes: fin(chords), melodia: fin(melody), fondo: fin(backing) };
}

/** Nota que suena en la melodía en cada momento, para chequear contra el acorde. */
export function melodyMidiAt(melody: MelodyEvent[], t: number): number | null {
  const e = melody.find((n) => t >= n.t - 0.001 && t < n.t + n.dur - 0.001);
  return e ? STRING_MIDI[e.string] + e.fret : null;
}
