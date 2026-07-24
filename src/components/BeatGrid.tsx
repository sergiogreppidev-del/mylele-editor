import { useEffect, useRef, useState } from 'react';
import { beatsPerBar, snap, tidy } from '../lib/chartFormat';
import type { ChordEvent } from '../lib/chartFormat';
import { chordColor } from '../lib/colors';

interface Props {
  events: ChordEvent[];
  timeSig: string;
  /** subdivisión del imán: 1 negra · 0.5 corchea · 0.25 semicorchea */
  step: number;
  pxPerBeat: number;
  bars: number;
  /** duración con la que se coloca un evento nuevo */
  defaultDur: number;
  /** acorde elegido en la paleta */
  brush: string | null;
  selected: number | null;
  /** beat del cursor de reproducción; null cuando está parado */
  cursorBeat: number | null;
  onSelect: (index: number | null) => void;
  onChange: (events: ChordEvent[]) => void;
}

type Drag =
  | { kind: 'move'; index: number; startX: number; startT: number }
  | { kind: 'resize'; index: number; startX: number; startDur: number };

/**
 * Grilla de tiempo en COMPASES Y TIEMPOS (nunca segundos).
 * Clic para colocar un acorde, arrastrar el cuerpo para moverlo,
 * arrastrar el borde derecho para cambiar su duración.
 */
export function BeatGrid({
  events, timeSig, step, pxPerBeat, bars, defaultDur, brush,
  selected, cursorBeat, onSelect, onChange,
}: Props) {
  const bpb = beatsPerBar(timeSig);
  const totalBeats = bars * bpb;
  const width = totalBeats * pxPerBeat;

  const laneRef = useRef<HTMLDivElement>(null);
  const [hoverBeat, setHoverBeat] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  /* --- arrastre (mover / redimensionar) --- */
  useEffect(() => {
    if (!drag) return;

    const onMove = (ev: MouseEvent) => {
      const dxBeats = (ev.clientX - drag.startX) / pxPerBeat;
      const next = [...events];
      const cur = next[drag.index];
      if (!cur) return;

      // Límites: no pisar al evento anterior ni al siguiente.
      const others = next.filter((_, i) => i !== drag.index).sort((a, b) => a.t - b.t);
      const before = [...others].reverse().find((o) => o.t <= cur.t);
      const after = others.find((o) => o.t > cur.t);
      const floor = before ? before.t + before.dur : 0;
      const ceil = after ? after.t : totalBeats;

      if (drag.kind === 'move') {
        let t = snap(drag.startT + dxBeats, step);
        t = Math.max(floor, Math.min(t, ceil - cur.dur));
        next[drag.index] = { ...cur, t: tidy(Math.max(0, t)) };
      } else {
        let dur = snap(drag.startDur + dxBeats, step);
        dur = Math.max(step, Math.min(dur, ceil - cur.t));
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
  }, [drag, events, onChange, pxPerBeat, step, totalBeats]);

  /* --- colocar un acorde nuevo --- */
  function beatFromEvent(clientX: number): number {
    const rect = laneRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, snap((clientX - rect.left) / pxPerBeat, step));
  }

  function handleLaneClick(ev: React.MouseEvent) {
    if (drag) return;
    if (!brush) return;
    const t = beatFromEvent(ev.clientX);
    if (t >= totalBeats) return;

    // Espacio disponible hasta el próximo evento.
    const sorted = [...events].sort((a, b) => a.t - b.t);
    const occupied = sorted.some((e) => t < e.t + e.dur - 0.001 && t + step > e.t + 0.001);
    if (occupied) return;
    const after = sorted.find((e) => e.t > t);
    const room = (after ? after.t : totalBeats) - t;
    const dur = tidy(Math.max(step, Math.min(defaultDur, room)));

    onChange([...events, { t: tidy(t), chord: brush, dur, dir: 'd' }]);
    onSelect(events.length);
  }

  /* --- líneas de compás y de tiempo --- */
  const lines = [];
  for (let b = 1; b < totalBeats; b++) {
    lines.push(
      <div
        key={b}
        className={'beat-line' + (b % bpb === 0 ? ' bar' : '')}
        style={{ left: b * pxPerBeat }}
      />,
    );
  }

  const ghostRoom = (() => {
    if (hoverBeat === null || !brush) return null;
    const after = [...events].sort((a, b) => a.t - b.t).find((e) => e.t > hoverBeat);
    const room = (after ? after.t : totalBeats) - hoverBeat;
    const occupied = events.some((e) => hoverBeat < e.t + e.dur - 0.001 && hoverBeat + step > e.t + 0.001);
    if (occupied || room <= 0) return null;
    return Math.max(step, Math.min(defaultDur, room));
  })();

  return (
    <div className="grid-wrap">
      <div className="grid-scroll" style={{ width }}>
        <div className="bar-ruler">
          {Array.from({ length: bars }, (_, i) => (
            <div key={i} className="bar" style={{ width: bpb * pxPerBeat }}>
              compás {i + 1}
            </div>
          ))}
        </div>

        <div
          ref={laneRef}
          className="lane"
          style={{ width }}
          onClick={handleLaneClick}
          onMouseMove={(e) => setHoverBeat(beatFromEvent(e.clientX))}
          onMouseLeave={() => setHoverBeat(null)}
        >
          {lines}

          {ghostRoom !== null && hoverBeat !== null && (
            <div
              className="ev"
              style={{
                left: hoverBeat * pxPerBeat,
                width: ghostRoom * pxPerBeat,
                background: chordColor(brush!).bg,
                opacity: 0.35,
                pointerEvents: 'none',
              }}
            >
              {brush}
            </div>
          )}

          {events.map((e, i) => {
            const col = chordColor(e.chord);
            return (
              <div
                key={i}
                className={'ev' + (selected === i ? ' sel' : '')}
                style={{
                  left: e.t * pxPerBeat,
                  width: Math.max(pxPerBeat * e.dur, 26),
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
                title={`${e.chord} · beat ${e.t} · ${e.dur} beat(s)`}
              >
                {e.chord}
                <span className="dir">{e.dir === 'u' ? '↑ arriba' : '↓ abajo'}</span>
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
  );
}
