import { barLines, beatsPerBar } from '../lib/chartFormat';
import type { BackingEvent, ChordEvent, MelodyEvent } from '../lib/chartFormat';
import { MAX_PLAYABLE_MIDI, MIN_PLAYABLE_MIDI, pitchToMidi } from '../lib/notation';
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
  pickup: number;
  /** Índices de acordes cuya armonía no cierra con la melodía. Se marcan en rojo. */
  choques?: number[];
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
export function LevelOverview({
  chords, melody, backing, timeSig, pxPerBeat, bars, cursorBeat, pickup, choques = [],
}: Props) {
  const marcados = new Set(choques);
  const bpb = beatsPerBar(timeSig);
  const totalBeats = pickup + bars * bpb;
  const width = totalBeats * pxPerBeat;

  // La melodía puede estar en su propia capa (nivel de notas) o dentro del fondo
  // marcada como 'lead' (nivel de acordes). En los dos casos va en SU fila: si se
  // dibuja mezclada con el resto del fondo, no se puede verificar nada.
  const lead = backing.filter((n) => n.v === 'lead');
  const resto = backing.filter((n) => n.v !== 'lead');

  const midisFondo = resto.map((n) => pitchToMidi(n.pitch)).filter((m): m is number => m !== null);
  const lo = midisFondo.length ? Math.min(...midisFondo) : MIN_PLAYABLE_MIDI;
  const hi = midisFondo.length ? Math.max(...midisFondo) : MAX_PLAYABLE_MIDI;
  const span = Math.max(12, hi - lo);

  const midisLead = lead.map((n) => pitchToMidi(n.pitch)).filter((m): m is number => m !== null);
  const loL = midisLead.length ? Math.min(...midisLead) : MIN_PLAYABLE_MIDI;
  const spanL = Math.max(12, (midisLead.length ? Math.max(...midisLead) : MAX_PLAYABLE_MIDI) - loL);

  const barras = barLines(totalBeats, timeSig, pickup);
  const esBarra = (b: number) => barras.some((x) => Math.abs(x - b) < 0.001);
  const lineas = [];
  for (let b = 1; b < totalBeats; b++) {
    lineas.push(
      <div key={b} className={'beat-line' + (esBarra(b) ? ' bar' : '')} style={{ left: b * pxPerBeat }} />,
    );
  }

  return (
    <div className="grid-wrap">
      <div className="grid-scroll" style={{ width: width + 62 }}>
        <div className="bar-ruler" style={{ marginLeft: 62 }}>
          {pickup > 0 && (
            <div className="bar" style={{ width: pickup * pxPerBeat }}>
              alzada
            </div>
          )}
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
                  className={'ov-chord' + (marcados.has(i) ? ' choca' : '')}
                  style={{
                    left: e.t * pxPerBeat,
                    width: Math.max(e.dur * pxPerBeat - 2, 16),
                    background: col.bg,
                  }}
                  title={
                    `${e.chord} · beat ${e.t}` +
                    (marcados.has(i) ? ' · la melodía no encaja en este acorde' : '')
                  }
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

            {/* La melodía que vive dentro del fondo, en la fila de melodía */}
            {lead.map((n, i) => {
              const midi = pitchToMidi(n.pitch);
              if (midi === null) return null;
              const y = 1 - (midi - loL) / spanL;
              return (
                <div
                  key={'l' + i}
                  className="ov-note"
                  style={{
                    left: n.t * pxPerBeat,
                    width: Math.max(n.dur * pxPerBeat - 2, 6),
                    top: H_ACORDES + 5 + y * (H_MELODIA - 14),
                    background: '#FFC42E',
                  }}
                  title={`${n.pitch} · beat ${n.t}`}
                />
              );
            })}

            {/* Fondo, como piano roll */}
            {resto.map((n, i) => {
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
