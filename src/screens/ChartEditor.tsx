import { useEffect, useMemo, useRef, useState } from 'react';
import { CandyButton } from '../components/CandyButton';
import { BeatGrid } from '../components/BeatGrid';
import { ChordPalette } from '../components/ChordPalette';
import { Issues } from '../components/Issues';
import { JsonPanel } from '../components/JsonPanel';
import { PreviewAudio } from '../lib/previewAudio';
import type { ChordPcs } from '../lib/previewAudio';
import {
  BPM_MAX, BPM_MIN, barCount, beatsPerBar, chartLengthBeats, dirForBeat,
  hasErrors, tidy, validateChart, validateSong,
} from '../lib/chartFormat';
import type { ChartMode, ChordEvent, Song, StrumPattern } from '../lib/chartFormat';
import {
  EMPTY_SONG, discardDraft, getSong, insertSong, publishChart, publishedChart,
  saveDraft, songMode, updateSong, workingChart,
} from '../lib/db';
import type { ChartRow, ChordRow, SongRow } from '../lib/db';
import { friendlyError } from '../lib/supabase';

interface Props {
  songId: string | null;
  chords: ChordRow[];
  canEdit: boolean;
  onBack: () => void;
  onReload: () => Promise<void>;
}

const STEPS: { value: number; label: string }[] = [
  { value: 1, label: 'Negra (1 tiempo)' },
  { value: 0.5, label: 'Corchea (½)' },
  { value: 0.25, label: 'Semicorchea (¼)' },
];

const PATTERNS: { value: StrumPattern; label: string }[] = [
  { value: 'todo-abajo', label: 'Todo ↓' },
  { value: 'alternado', label: 'Alternado ↓↑' },
  { value: 'island', label: 'Island D–DU–UDU' },
];

export function ChartEditor({ songId, chords, canEdit, onBack, onReload }: Props) {
  const [song, setSong] = useState<Song>({ ...EMPTY_SONG });
  const [id, setId] = useState<string | null>(songId);
  const [loaded, setLoaded] = useState<SongRow | null>(null);
  const [mode, setMode] = useState<ChartMode>('chords');
  const [events, setEvents] = useState<ChordEvent[]>([]);

  const [brush, setBrush] = useState<string | null>(chords[0]?.id ?? null);
  const [selected, setSelected] = useState<number | null>(null);
  const [step, setStep] = useState(1);
  const [pxPerBeat, setPxPerBeat] = useState(64);
  const [minBars, setMinBars] = useState(4);
  const [defaultDur, setDefaultDur] = useState(4);

  const [cursorBeat, setCursorBeat] = useState<number | null>(null);
  const [metronome, setMetronome] = useState(true);
  const [backing, setBacking] = useState(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const audio = useRef<PreviewAudio | null>(null);
  if (!audio.current) audio.current = new PreviewAudio();
  useEffect(() => () => audio.current?.stop(), []);

  /* ---------- carga ---------- */
  useEffect(() => {
    let alive = true;
    if (!songId) {
      setSong({ ...EMPTY_SONG });
      setEvents([]);
      setLoaded(null);
      setMode('chords');
      return;
    }
    void (async () => {
      try {
        const row = await getSong(songId);
        if (!alive) return;
        const m = songMode(row);
        const work = workingChart(row, m);
        setLoaded(row);
        setId(row.id);
        setMode(m);
        setSong({ ...row });
        setEvents((work?.events ?? []).filter((e): e is ChordEvent => 'chord' in e));
        setDirty(false);
      } catch (e) {
        if (alive) setError(friendlyError(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [songId]);

  const bpb = beatsPerBar(song.time_sig);
  const bars = useMemo(() => barCount(events, song.time_sig, minBars), [events, song.time_sig, minBars]);

  const chordPcs: ChordPcs = useMemo(() => {
    const map: ChordPcs = {};
    chords.forEach((c) => (map[c.id] = c.pitch_classes));
    return map;
  }, [chords]);

  const songIssues = useMemo(() => validateSong(song), [song]);
  const chartIssues = useMemo(
    () => validateChart(events, mode, { knownChords: chords.map((c) => c.id), timeSig: song.time_sig }),
    [events, mode, chords, song.time_sig],
  );
  const allIssues = [...songIssues, ...chartIssues];
  const blocked = hasErrors(allIssues);

  const liveChart: ChartRow | null = loaded ? publishedChart(loaded, mode) : null;
  const workChart: ChartRow | null = loaded ? workingChart(loaded, mode) : null;
  const hasUnpublishedDraft = !!workChart && !workChart.published;

  function patch(next: Partial<Song>) {
    setSong((s) => ({ ...s, ...next }));
    setDirty(true);
  }
  function setEv(next: ChordEvent[]) {
    setEvents(next);
    setDirty(true);
  }

  /* ---------- atajos ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected !== null) {
        e.preventDefault();
        setEv(events.filter((_, i) => i !== selected));
        setSelected(null);
      }
      if (e.key === 'ArrowUp' && selected !== null) {
        e.preventDefault();
        setEv(events.map((ev, i) => (i === selected ? { ...ev, dir: 'u' } : ev)));
      }
      if (e.key === 'ArrowDown' && selected !== null) {
        e.preventDefault();
        setEv(events.map((ev, i) => (i === selected ? { ...ev, dir: 'd' } : ev)));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, selected]);

  /* ---------- herramientas ---------- */

  /** Copia un compás e inserta la copia justo después, corriendo lo que venga detrás. */
  function duplicateBar(barIndex: number) {
    const from = barIndex * bpb;
    const to = from + bpb;
    const inBar = events.filter((e) => e.t >= from && e.t < to);
    if (inBar.length === 0) return;
    const shifted = events.map((e) => (e.t >= to ? { ...e, t: tidy(e.t + bpb) } : e));
    const copy = inBar.map((e) => ({ ...e, t: tidy(e.t + bpb) }));
    setEv([...shifted, ...copy]);
    setSelected(null);
  }

  /** Repite la progresión completa N veces (útil para armar una canción entera). */
  function repeatAll(times: number) {
    if (events.length === 0 || times < 2) return;
    const lenBars = Math.ceil(chartLengthBeats(events) / bpb);
    const block = lenBars * bpb;
    const out = [...events];
    for (let k = 1; k < times; k++) {
      events.forEach((e) => out.push({ ...e, t: tidy(e.t + block * k) }));
    }
    setEv(out);
    setSelected(null);
  }

  /** Aplica un patrón de rasgueo a todos los eventos según su lugar en el compás. */
  function applyPattern(p: StrumPattern) {
    setEv(events.map((e) => ({ ...e, dir: dirForBeat(p, e.t % bpb) })));
  }

  /* ---------- reproducción ---------- */
  function play() {
    if (events.length === 0) return;
    audio.current?.play({
      events,
      bpm: song.bpm,
      beatsPerBar: bpb,
      chordPcs,
      metronome,
      backing,
      onBeat: (b) => setCursorBeat(b),
      onEnd: () => setCursorBeat(null),
    });
  }
  function stop() {
    audio.current?.stop();
    setCursorBeat(null);
  }

  /* ---------- guardar / publicar ---------- */
  async function persist(publish: boolean) {
    if (!canEdit) return;
    if (hasErrors(songIssues)) {
      setError('Revisá los datos del nivel antes de guardar.');
      return;
    }
    if (publish && blocked) {
      setError('No se puede publicar: el nivel tiene errores.');
      return;
    }
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      let sid = id;
      if (sid) {
        await updateSong(sid, song);
      } else {
        const created = await insertSong(song);
        sid = created.id;
        setId(sid);
      }

      const existing = loaded?.charts ?? [];
      const draft = await saveDraft(sid, mode, events, existing);
      if (publish) await publishChart(draft.id);

      const fresh = await getSong(sid);
      setLoaded(fresh);
      setDirty(false);
      setFlash(publish ? '🎉 Publicado: ya está en vivo para los alumnos.' : '💾 Borrador guardado (los alumnos todavía no lo ven).');
      await onReload();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleDiscard() {
    if (!workChart || workChart.published) return;
    const ok = window.confirm('¿Descartar el borrador y volver a la versión publicada?');
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await discardDraft(workChart.id);
      const fresh = await getSong(id!);
      setLoaded(fresh);
      const work = workingChart(fresh, mode);
      setEvents((work?.events ?? []).filter((e): e is ChordEvent => 'chord' in e));
      setDirty(false);
      setFlash('Borrador descartado.');
      await onReload();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const selectedEvent = selected !== null ? events[selected] : undefined;

  return (
    <div className="stack-16">
      <div className="row">
        <CandyButton tone="ghost" small onClick={onBack}>
          ← Volver
        </CandyButton>
        <h2 style={{ fontSize: 22 }}>{id ? song.title || 'Nivel sin título' : 'Nivel nuevo'}</h2>
        {liveChart && <span className="badge live">● En vivo</span>}
        {hasUnpublishedDraft && <span className="badge draft">✎ Borrador sin publicar</span>}
        {dirty && <span className="badge">Cambios sin guardar</span>}
      </div>

      {!canEdit && (
        <div className="notice bad">
          Tu usuario no está habilitado para editar. Podés mirar, pero la base va a rechazar cualquier cambio.
        </div>
      )}
      {error && <div className="notice bad">{error}</div>}
      {flash && <div className="notice good">{flash}</div>}

      {/* ---------- datos del nivel ---------- */}
      <div className="card">
        <div className="section-title" style={{ marginBottom: 10 }}>
          Datos del nivel
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          <label className="field">
            <span>Título</span>
            <input className="f" value={song.title} onChange={(e) => patch({ title: e.target.value })} />
          </label>
          <label className="field">
            <span>Identificador (slug)</span>
            <input
              className="f"
              value={song.slug}
              placeholder="nivel-5-vals"
              onChange={(e) => patch({ slug: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Artista</span>
            <input className="f" value={song.artist ?? ''} onChange={(e) => patch({ artist: e.target.value })} />
          </label>
          <label className="field">
            <span>Nivel</span>
            <input
              className="f tnum"
              type="number"
              min={1}
              value={song.level}
              onChange={(e) => patch({ level: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            <span>BPM ({BPM_MIN}–{BPM_MAX})</span>
            <input
              className="f tnum"
              type="number"
              min={BPM_MIN}
              max={BPM_MAX}
              value={song.bpm}
              onChange={(e) => patch({ bpm: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            <span>Compás</span>
            <select className="f" value={song.time_sig} onChange={(e) => patch({ time_sig: e.target.value })}>
              <option value="4/4">4/4</option>
              <option value="3/4">3/4</option>
              <option value="2/4">2/4</option>
              <option value="6/8">6/8</option>
            </select>
          </label>
          <label className="field">
            <span>Modo</span>
            <select
              className="f"
              value={mode}
              disabled={!!liveChart || !!workChart}
              onChange={(e) => {
                setMode(e.target.value as ChartMode);
                setDirty(true);
              }}
            >
              <option value="chords">Acordes</option>
              <option value="melody">Notas (tablatura)</option>
            </select>
          </label>
          <label className="field">
            <span>Acceso</span>
            <div className="row" style={{ height: 40 }}>
              <input
                className="f"
                type="checkbox"
                checked={song.is_free}
                onChange={(e) => patch({ is_free: e.target.checked })}
              />
              <span>{song.is_free ? 'Gratis' : 'Premium'}</span>
            </div>
          </label>
        </div>
      </div>

      {mode === 'melody' ? (
        <div className="notice warn">
          Este nivel está en <b>modo notas (tablatura)</b>. El editor visual de notas llega en la fase 2 —
          por ahora se puede editar la ficha del nivel, pero no los eventos. El formato de notas usa{' '}
          <b>cuerda + traste</b> (<code>{'{"t":0,"string":"C","fret":0,"dur":1}'}</code>), nunca el nombre de la nota.
        </div>
      ) : (
        <>
          {/* ---------- paleta ---------- */}
          <div className="card">
            <div className="section-title" style={{ marginBottom: 10 }}>
              Acordes · elegí uno y hacé clic en la grilla
            </div>
            <ChordPalette chords={chords} selected={brush} onSelect={setBrush} />
          </div>

          {/* ---------- grilla ---------- */}
          <div className="card">
            <div className="row" style={{ marginBottom: 10 }}>
              <label className="field" style={{ width: 160 }}>
                <span>Imán</span>
                <select className="f" value={step} onChange={(e) => setStep(Number(e.target.value))}>
                  {STEPS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field" style={{ width: 130 }}>
                <span>Duración nueva</span>
                <select className="f" value={defaultDur} onChange={(e) => setDefaultDur(Number(e.target.value))}>
                  <option value={0.5}>½ tiempo</option>
                  <option value={1}>1 tiempo</option>
                  <option value={2}>2 tiempos</option>
                  <option value={4}>1 compás</option>
                </select>
              </label>
              <div className="grow" />
              <div className="row">
                <span className="muted">Zoom</span>
                <CandyButton small tone="ghost" onClick={() => setPxPerBeat((p) => Math.max(28, p - 12))}>
                  −
                </CandyButton>
                <CandyButton small tone="ghost" onClick={() => setPxPerBeat((p) => Math.min(140, p + 12))}>
                  +
                </CandyButton>
              </div>
              <div className="row">
                <span className="muted">Compases</span>
                <CandyButton small tone="ghost" onClick={() => setMinBars((b) => Math.max(1, b - 1))}>
                  −
                </CandyButton>
                <span className="tnum" style={{ minWidth: 22, textAlign: 'center' }}>
                  {bars}
                </span>
                <CandyButton small tone="ghost" onClick={() => setMinBars((b) => b + 1)}>
                  +
                </CandyButton>
              </div>
            </div>

            <BeatGrid
              events={events}
              timeSig={song.time_sig}
              step={step}
              pxPerBeat={pxPerBeat}
              bars={bars}
              defaultDur={defaultDur}
              brush={brush}
              selected={selected}
              cursorBeat={cursorBeat}
              onSelect={setSelected}
              onChange={setEv}
            />

            {/* ---------- inspector del evento ---------- */}
            <div className="row" style={{ marginTop: 10 }}>
              {selectedEvent ? (
                <>
                  <span className="muted">
                    Seleccionado: <b>{selectedEvent.chord}</b> · beat {selectedEvent.t} · dura {selectedEvent.dur}
                  </span>
                  <CandyButton
                    small
                    tone={selectedEvent.dir === 'd' ? 'sky' : 'ghost'}
                    onClick={() => setEv(events.map((e, i) => (i === selected ? { ...e, dir: 'd' } : e)))}
                  >
                    ↓ Abajo
                  </CandyButton>
                  <CandyButton
                    small
                    tone={selectedEvent.dir === 'u' ? 'sky' : 'ghost'}
                    onClick={() => setEv(events.map((e, i) => (i === selected ? { ...e, dir: 'u' } : e)))}
                  >
                    ↑ Arriba
                  </CandyButton>
                  <CandyButton
                    small
                    tone="melon"
                    onClick={() => {
                      setEv(events.filter((_, i) => i !== selected));
                      setSelected(null);
                    }}
                  >
                    Borrar
                  </CandyButton>
                </>
              ) : (
                <span className="muted">
                  Clic en la grilla para colocar · arrastrá el borde derecho para alargar · Supr borra · ↑↓ cambia el rasgueo
                </span>
              )}
            </div>
          </div>

          {/* ---------- atajos de estructura ---------- */}
          <div className="card">
            <div className="section-title" style={{ marginBottom: 10 }}>
              Atajos
            </div>
            <div className="row">
              <span className="muted">Rasgueo:</span>
              {PATTERNS.map((p) => (
                <CandyButton key={p.value} small tone="sun" onClick={() => applyPattern(p.value)}>
                  {p.label}
                </CandyButton>
              ))}
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <span className="muted">Estructura:</span>
              <select
                className="f"
                style={{ width: 150 }}
                defaultValue=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (v !== '') duplicateBar(Number(v));
                  e.target.value = '';
                }}
              >
                <option value="">Duplicar compás…</option>
                {Array.from({ length: bars }, (_, i) => (
                  <option key={i} value={i}>
                    compás {i + 1}
                  </option>
                ))}
              </select>
              <select
                className="f"
                style={{ width: 150 }}
                defaultValue=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (v !== '') repeatAll(Number(v));
                  e.target.value = '';
                }}
              >
                <option value="">Repetir todo…</option>
                <option value="2">× 2</option>
                <option value="3">× 3</option>
                <option value="4">× 4</option>
              </select>
              <CandyButton
                small
                tone="melon"
                onClick={() => {
                  if (window.confirm('¿Borrar todos los eventos del chart?')) {
                    setEv([]);
                    setSelected(null);
                  }
                }}
              >
                Vaciar chart
              </CandyButton>
            </div>
          </div>

          {/* ---------- reproducción de prueba ---------- */}
          <div className="card">
            <div className="section-title" style={{ marginBottom: 10 }}>
              Escuchar (sin micrófono — solo para validar que suene y se lea bien)
            </div>
            <div className="row">
              <CandyButton tone="lime" onClick={play} disabled={events.length === 0}>
                ▶ Reproducir
              </CandyButton>
              <CandyButton tone="ghost" onClick={stop}>
                ■ Parar
              </CandyButton>
              <label className="row" style={{ gap: 6 }}>
                <input
                  className="f"
                  type="checkbox"
                  checked={metronome}
                  onChange={(e) => setMetronome(e.target.checked)}
                />
                <span>Metrónomo</span>
              </label>
              <label className="row" style={{ gap: 6 }}>
                <input className="f" type="checkbox" checked={backing} onChange={(e) => setBacking(e.target.checked)} />
                <span>Acompañamiento</span>
              </label>
              <span className="muted">
                Entra con un compás de cuenta · {song.bpm} BPM · {tidy(chartLengthBeats(events))} beats
              </span>
            </div>
          </div>
        </>
      )}

      <Issues issues={allIssues} />
      <JsonPanel events={events} />

      {/* ---------- guardar ---------- */}
      <div className="card">
        <div className="row">
          <CandyButton tone="sun" onClick={() => void persist(false)} disabled={!canEdit || busy || hasErrors(songIssues)}>
            💾 Guardar borrador
          </CandyButton>
          <CandyButton tone="lime" onClick={() => void persist(true)} disabled={!canEdit || busy || blocked}>
            🚀 Publicar
          </CandyButton>
          {hasUnpublishedDraft && liveChart && (
            <CandyButton tone="ghost" onClick={() => void handleDiscard()} disabled={busy}>
              Descartar borrador
            </CandyButton>
          )}
          <div className="grow" />
          <span className="muted">
            {blocked
              ? 'Publicar está bloqueado hasta resolver los errores.'
              : 'Publicar deja el nivel en vivo para los alumnos.'}
          </span>
        </div>
      </div>
    </div>
  );
}
