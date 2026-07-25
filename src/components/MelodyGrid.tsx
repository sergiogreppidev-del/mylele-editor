import { useEffect, useRef, useState } from 'react';
import { UKE_STRINGS, beatsPerBar, snap, tidy } from '../lib/chartFormat';
import type { MelodyEvent, UkeString } from '../lib/chartFormat';
import { STRING_MIDI, midiToPitch } from '../lib/notation';

/** Mismos colores que usa la pista del juego (config.js), para que se lea igual. */
export const STRING_COLORS: Record<UkeString, { bg: string; shadow: string }> = {
  G: { bg: '#FFC42E', shadow: '#DD9700' },
  C: { bg: '#7FD94C', shadow: '#54AC26' },
  E: { bg: '#FF5F7E', shadow: '#D3395A' },
  A: { bg: '#4FC9F5', shadow: '#2196C9' },
};

const LANE_H = 46;

interface Props {
  events: MelodyEvent[];
  timeSig: string;
  step: number;
  pxPerBeat: number;
  bars: number;
  defaultDur: number;
  /** Traste con el que se coloca una nota nueva. */
  fretBrush: number;
  selected: number | null;
  cursorBeat: number | null;
  onSelect: (index: number | null) => void;
  onChange: (events: MelodyEvent[]) => void;
}

type Drag =
  | { kind: 'move'; index: number; startX: number; startT: number }
  | { kind: 'resize'; index: number; startX: number; startDur: number };

/**
 * Tablatura: un carril por cuerda (G · C · E · A de arriba hacia abajo, igual que
 * en la pista del juego). Se coloca CUERDA + TRASTE, nunca el nombre de la nota:
 * la app calcula la nota sola y dibuja el número de traste.
 */
export function MelodyGrid({
  events, timeSig, step, pxPerBeat, bars, defaultDur, fretBrush,
  selected, cursorBeat, onSelect, onChange,
}: Props) {
  const bpb = beatsPerBar(timeSig);
  const totalBeats = bars * bpb;
  const width = totalBeats * pxPerBeat;

  const lanesRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ beat: number; lane: number } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  function posFrom(clientX: number, clientY: number) {
    const rect = lanesRef.current?.getBoundingClientRect();
    if (!rect) return { beat: 0, lane: 0 };
    const beat = Math.max(0, snap((clientX - rect.left) / pxPerBeat, step));
    const lane = Math.max(0, Math.min(3, Math.floor((clientY - rect.top) / LANE_H)));
    return { beat, lane };
  }

  /* --- arrastre: horizontal cambia el tiempo, vertical cambia de cuerda --- */
  useEffect(() => {
    if (!drag) return;

    const onMove = (ev: MouseEvent) => {
      const next = [...events];
      const cur = next[drag.index];
      if (!cur) return;
      const dxBeats = (ev.clientX - drag.startX) / pxPerBeat;

      if (drag.kind === 'move') {
        const { lane } = posFrom(ev.clientX, ev.clientY);
        const str = UKE_STRINGS[lane];
        // Los límites se miden contra las notas de la MISMA cuerda: dos cuerdas
        // distintas pueden sonar a la vez, eso es un arpegio.
        const others = next
          .filter((_, i) => i !== drag.index)
          .filter((o) => o.string === str)
          .sort((a, b) => a.t - b.t);
        let t = snap(drag.startT + dxBeats, step);
        const before = [...others].reverse().find((o) => o.t <= t);
        const after = others.find((o) => o.t > t);
        const floor = before ? before.t + before.dur : 0;
        const ceil = after ? after.t : totalBeats;
        t = Math.max(floor, Math.min(t, ceil - cur.dur));
        next[drag.index] = { ...cur, t: tidy(Math.max(0, t)), string: str };
      } else {
        const others = next
          .filter((_, i) => i !== drag.index)
          .filter((o) => o.string === cur.string && o.t > cur.t)
          .sort((a, b) => a.t - b.t);
        const ceil = others.length ? others[0].t : totalBeats;
        const dur = Math.max(step, Math.min(snap(drag.startDur + dxBeats, step), ceil - cur.t));
        next[drag.index] = { ...cur, dur: tidy(dur) };
      }
      onChange(next);
    };

    const onUp = () => setDrag(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, events, pxPerBeat, step, totalBeats]);

  function handleClick(ev: React.MouseEvent) {
    if (drag) return;
    const { beat, lane } = posFrom(ev.clientX, ev.clientY);
    if (beat >= totalBeats) return;
    const str = UKE_STRINGS[lane];

    const sameString = events.filter((e) => e.string === str).sort((a, b) => a.t - b.t);
    const ocupado = sameString.some((e) => beat < e.t + e.dur - 0.001 && beat + step > e.t + 0.001);
    if (ocupado) return;
    const after = sameString.find((e) => e.t > beat);
    const room = (after ? after.t : totalBeats) - beat;
    const dur = tidy(Math.max(step, Math.min(defaultDur, room)));

    onChange([...events, { t: tidy(beat), string: str, fret: fretBrush, dur }]);
    onSelect(events.length);
  }

  const lines = [];
  for (let b = 1; b < totalBeats; b++) {
    lines.push(
      <div key={b} className={'beat-line' + (b % bpb === 0 ? ' bar' : '')} style={{ left: b * pxPerBeat }} />,
    );
  }

  return (
    <div className="grid-wrap">
      <div className="grid-scroll" style={{ width: width + 34 }}>
        <div className="bar-ruler" style={{ marginLeft: 34 }}>
          {Array.from({ length: bars }, (_, i) => (
            <div key={i} className="bar" style={{ width: bpb * pxPerBeat }}>
              compás {i + 1}
            </div>
          ))}
        </div>

        <div className="mel-wrap">
          <div className="mel-labels">
            {UKE_STRINGS.map((s) => (
              <div key={s} className="mel-label" style={{ height: LANE_H, color: STRING_COLORS[s].shadow }}>
                {s}
              </div>
            ))}
          </div>

          <div
            ref={lanesRef}
            className="mel-lanes"
            style={{ width, height: LANE_H * 4 }}
            onClick={handleClick}
            onMouseMove={(e) => setHover(posFrom(e.clientX, e.clientY))}
            onMouseLeave={() => setHover(null)}
          >
            {UKE_STRINGS.map((s, i) => (
              <div key={s} className="mel-lane" style={{ top: i * LANE_H, height: LANE_H }} />
            ))}
            {lines}

            {hover && (
              <div
                className="mel-note ghost"
                style={{
                  left: hover.beat * pxPerBeat,
                  top: hover.lane * LANE_H + 7,
                  width: Math.max(defaultDur * pxPerBeat, 30),
                  background: STRING_COLORS[UKE_STRINGS[hover.lane]].bg,
                }}
              >
                {fretBrush}
              </div>
            )}

            {events.map((e, i) => {
              const lane = UKE_STRINGS.indexOf(e.string);
              if (lane < 0) return null;
              const col = STRING_COLORS[e.string];
              return (
                <div
                  key={i}
                  className={'mel-note' + (selected === i ? ' sel' : '')}
                  style={{
                    left: e.t * pxPerBeat,
                    top: lane * LANE_H + 7,
                    width: Math.max(e.dur * pxPerBeat, 30),
                    background: col.bg,
                    boxShadow: `0 4px 0 ${col.shadow}`,
                  }}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onSelect(i);
                  }}
                  onMouseDown={(ev) => {
                    ev.stopPropagation();
                    onSelect(i);
                    setDrag({ kind: 'move', index: i, startX: ev.clientX, startT: e.t });
                  }}
                  title={`cuerda ${e.string} · traste ${e.fret} · suena ${midiToPitch(STRING_MIDI[e.string] + e.fret)} · beat ${e.t}`}
                >
                  {e.fret}
                  <span
                    className="handle"
                    onMouseDown={(ev) => {
                      ev.stopPropagation();
                      onSelect(i);
                      setDrag({ kind: 'resize', index: i, startX: ev.clientX, startDur: e.dur });
                    }}
                  />
                </div>
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
