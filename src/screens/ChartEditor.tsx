import { useEffect, useMemo, useRef, useState } from 'react';
import { CandyButton } from '../components/CandyButton';
import { BeatGrid } from '../components/BeatGrid';
import { MelodyGrid } from '../components/MelodyGrid';
import { ChordPalette } from '../components/ChordPalette';
import { Issues } from '../components/Issues';
import { JsonPanel } from '../components/JsonPanel';
import { Steps } from '../components/Steps';
import type { Step } from '../components/Steps';
import { PreviewAudio } from '../lib/previewAudio';
import type { ChordPcs } from '../lib/previewAudio';
import { BackingLane } from '../components/BackingLane';
import { LevelOverview, largoDeCapas } from '../components/LevelOverview';
import { ImportDialog } from '../components/ImportDialog';
import { DificultadPanel } from '../components/DificultadPanel';
import { acordesPara, medirAcordes, medirMelodia, verificarPerfil } from '../lib/dificultad';
import type { Digitaciones } from '../lib/dificultad';
import { STRING_MIDI, midiToPitch, validateBacking } from '../lib/notation';
import type { ImportTarget } from '../lib/aiPrompt';
import {
  BACKING_MODE, BPM_MAX, BPM_MIN, DIFICULTADES, ETAPA_ACTUAL, MAX_FRET, UKE_STRINGS, barCount,
  beatsPerBar, chartLengthBeats, dirForBeat, hasErrors, tidy, validateChart, validateSong,
} from '../lib/chartFormat';
import type {
  BackingEvent, ChartEvent, ChartMode, ChordEvent, Difficulty, MelodyEvent, Song, StrumPattern,
} from '../lib/chartFormat';
import {
  EMPTY_SONG, backingUrl, deleteBacking, discardDraft, discardSongDraft, effectiveSong,
  getSong, hasSongDraft, insertSong, publishChart, publishSongMeta, publishedChart,
  saveDraft, saveSongDraft, songDifficulty, songMode, uploadBacking, workingChart,
} from '../lib/db';
import type { ChartRow, ChordRow, SongRow } from '../lib/db';
import { friendlyError } from '../lib/supabase';

interface Props {
  songId: string | null;
  /** Tipo elegido en el listado al crear. Para un nivel que ya existe, se ignora. */
  nuevoModo?: ChartMode;
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

export function ChartEditor({ songId, nuevoModo, chords, canEdit, onBack, onReload }: Props) {
  const [song, setSong] = useState<Song>({ ...EMPTY_SONG });
  const [id, setId] = useState<string | null>(songId);
  const [loaded, setLoaded] = useState<SongRow | null>(null);
  const [mode, setMode] = useState<ChartMode>(nuevoModo ?? 'chords');
  const [events, setEvents] = useState<ChordEvent[]>([]);
  const [melody, setMelody] = useState<MelodyEvent[]>([]);
  const [backingNotes, setBackingNotes] = useState<BackingEvent[]>([]);
  const [importTarget, setImportTarget] = useState<ImportTarget | null>(null);
  /** Qué versión se está editando. La elige el juego, no el alumno. */
  const [dificultad, setDificultad] = useState<Difficulty>('facil');

  const [brush, setBrush] = useState<string | null>(chords[0]?.id ?? null);
  const [fretBrush, setFretBrush] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [step, setStep] = useState(1);
  const [pxPerBeat, setPxPerBeat] = useState(64);
  const [minBars, setMinBars] = useState(4);
  const [defaultDur, setDefaultDur] = useState(4);

  const [paso, setPaso] = useState<'datos' | 'musica' | 'sonido' | 'publicar'>('datos');
  const [uploading, setUploading] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [cursorBeat, setCursorBeat] = useState<number | null>(null);
  const [metronome, setMetronome] = useState(true);
  const [backing, setBacking] = useState(true);
  /** Desde qué compás escuchar. Verificar el final no puede costar la canción entera. */
  const [desdeCompas, setDesdeCompas] = useState(1);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const audio = useRef<PreviewAudio | null>(null);
  if (!audio.current) audio.current = new PreviewAudio();
  // Al salir de la pantalla sí se cierra el motor de audio; entre reproducciones no.
  useEffect(() => () => audio.current?.dispose(), []);

  /**
   * Vuelca a la pantalla las capas de una fila YA TRAÍDA. Sin red.
   * Cambiar de sub-nivel no necesita volver a consultar la base: la fila ya trae
   * todos los charts de la canción.
   */
  function cargarCapas(row: SongRow, m: ChartMode, d: Difficulty) {
    const work = workingChart(row, m, d);
    setEvents((work?.events ?? []).filter((e): e is ChordEvent => 'chord' in e));
    setMelody((work?.events ?? []).filter((e): e is MelodyEvent => 'string' in e));
    setBackingNotes(workingChart(row, BACKING_MODE, 'facil')?.backing ?? []);
    setSelected(null);
    setDirty(false);
  }

  /* ---------- carga ---------- */
  useEffect(() => {
    let alive = true;
    if (!songId) {
      setSong({ ...EMPTY_SONG });
      setEvents([]);
      setMelody([]);
      setBackingNotes([]);
      setLoaded(null);
      // El tipo lo eligió el autor en el listado. Es la única fuente: deducirlo
      // después de lo que devuelva la IA era lo que impedía crear niveles de notas.
      setMode(nuevoModo ?? 'chords');
      setDificultad('facil');
      setPaso('datos');   // un nivel nuevo empieza por la ficha, que está vacía
      return;
    }
    void (async () => {
      try {
        const row = await getSong(songId);
        if (!alive) return;
        // El tipo y el sub-nivel salen de lo que la canción TIENE. Abrir siempre en
        // el sub-nivel 1 mostraba la grilla vacía si la canción vivía en el otro.
        const m = songMode(row);
        const d = songDifficulty(row);
        setLoaded(row);
        setId(row.id);
        setMode(m);
        setDificultad(d);
        setSong(effectiveSong(row));   // lo publicado con el borrador de la ficha encima
        cargarCapas(row, m, d);
        // Un nivel que ya existe tiene la ficha completa: se entra directo a la
        // música, que es lo que se viene a tocar el 90% de las veces.
        setPaso('musica');
      } catch (e) {
        if (alive) setError(friendlyError(e));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId, nuevoModo]);

  const bpb = beatsPerBar(song.time_sig);
  /** Lo que toca el alumno, sea acordes o notas. */
  const playable: ChartEvent[] = mode === 'melody' ? melody : events;

  // La grilla se estira a la capa más larga: el fondo puede pasarse de lo jugable.
  const bars = useMemo(
    () =>
      Math.max(
        barCount(playable, song.time_sig, minBars, song.pickup_beats),
        barCount(backingNotes, song.time_sig, minBars, song.pickup_beats),
      ),
    [playable, backingNotes, song.time_sig, minBars, song.pickup_beats],
  );

  /** Las digitaciones, que son con lo que se mide qué tan difícil es el nivel. */
  const digitaciones: Digitaciones = useMemo(() => {
    const map: Digitaciones = {};
    chords.forEach((c) => (map[c.id] = c.frets));
    return map;
  }, [chords]);

  /** Los acordes que este sub-nivel deja usar: los que menos dedos piden. */
  const acordesPermitidos = useMemo(
    () => acordesPara(dificultad, digitaciones),
    [dificultad, digitaciones],
  );

  /**
   * La dificultad, medida. Los tres niveles publicados daban todos ~18 cambios por
   * minuto con los mismos 4 acordes y no había forma de notarlo sin tocarlos.
   */
  const metricas = useMemo(
    () =>
      mode === 'melody'
        ? medirMelodia(melody, song.bpm)
        : medirAcordes(events, digitaciones, song.bpm, song.time_sig),
    [mode, melody, events, digitaciones, song.bpm, song.time_sig],
  );

  const perfilIssues = useMemo(
    () => (metricas.tipo === 'chords' ? verificarPerfil(metricas, dificultad, digitaciones) : []),
    [metricas, dificultad, digitaciones],
  );

  const chordPcs: ChordPcs = useMemo(() => {
    const map: ChordPcs = {};
    chords.forEach((c) => (map[c.id] = c.pitch_classes));
    return map;
  }, [chords]);

  const songIssues = useMemo(() => validateSong(song), [song]);
  const chartIssues = useMemo(
    () => validateChart(playable, mode, { knownChords: chords.map((c) => c.id), timeSig: song.time_sig }),
    [playable, mode, chords, song.time_sig],
  );
  const backingIssues = useMemo(() => validateBacking(backingNotes), [backingNotes]);
  const allIssues = [...songIssues, ...chartIssues, ...backingIssues, ...perfilIssues];
  const blocked = hasErrors(allIssues);

  const liveChart: ChartRow | null = loaded ? publishedChart(loaded, mode, dificultad) : null;
  const workChart: ChartRow | null = loaded ? workingChart(loaded, mode, dificultad) : null;
  const hasUnpublishedDraft = !!workChart && !workChart.published;
  const fichaEnBorrador = !!loaded && hasSongDraft(loaded);

  function patch(next: Partial<Song>) {
    setSong((s) => ({ ...s, ...next }));
    setDirty(true);
  }

  /** Cambiar de sub-nivel vuelve a leer las capas de la fila, así que se avisa. */
  function cambiarDificultad(d: Difficulty) {
    if (d === dificultad) return;
    if (dirty && !window.confirm('Tenés cambios sin guardar. ¿Cambiar de sub-nivel igual?')) return;
    setDificultad(d);
    if (loaded) cargarCapas(loaded, mode, d);
  }

  /** ¿Se puede salir? Media hora de trabajo no se tira sin preguntar. */
  function salir() {
    if (dirty && !window.confirm('Tenés cambios sin guardar. Si salís, se pierden. ¿Salir igual?')) return;
    onBack();
  }

  // Cerrar la pestaña es la otra puerta por la que se perdía todo sin aviso.
  useEffect(() => {
    if (!dirty) return;
    const avisar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [dirty]);

  /** "Nivel 5 · Vals de las flores" → "nivel-5-vals-de-las-flores" */
  function aSlug(txt: string): string {
    return txt
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // saca acentos
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  }

  /** El identificador se arma solo del título mientras nadie lo haya tocado a mano. */
  function patchTitulo(title: string) {
    const autoAntes = aSlug(song.title);
    const tocadoAMano = song.slug !== '' && song.slug !== autoAntes;
    patch({ title, ...(tocadoAMano ? {} : { slug: aSlug(title) }) });
  }

  const PASOS: Step[] = [
    { id: 'datos', label: 'Datos', problema: hasErrors(songIssues) },
    { id: 'musica', label: 'Música', problema: hasErrors(chartIssues) },
    { id: 'sonido', label: 'Sonido', problema: hasErrors(backingIssues) },
    { id: 'publicar', label: 'Publicar' },
  ];
  const pasoIdx = PASOS.findIndex((p) => p.id === paso);
  function setEv(next: ChordEvent[]) {
    setEvents(next);
    setDirty(true);
  }
  function setMel(next: MelodyEvent[]) {
    setMelody(next);
    setDirty(true);
  }
  /** Escribe la capa jugable, sea la que sea. Las herramientas la usan sin saber el modo. */
  function setPlayable(next: ChartEvent[]) {
    if (mode === 'melody') setMel(next as MelodyEvent[]);
    else setEv(next as ChordEvent[]);
  }
  function applyBacking(next: BackingEvent[]) {
    setBackingNotes(next);
    setDirty(true);
  }

  /* ---------- atajos ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
      if (selected === null) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        setPlayable(playable.filter((_, i) => i !== selected));
        setSelected(null);
        return;
      }

      if (mode === 'chords') {
        // En acordes, las flechas cambian la dirección del rasgueo.
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const dir = e.key === 'ArrowUp' ? 'u' : 'd';
          setEv(events.map((ev, i) => (i === selected ? { ...ev, dir } : ev)));
        }
        return;
      }

      // En notas, las flechas cambian de cuerda y los números escriben el traste.
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const delta = e.key === 'ArrowUp' ? -1 : 1;
        setMel(
          melody.map((ev, i) => {
            if (i !== selected) return ev;
            const lane = UKE_STRINGS.indexOf(ev.string) + delta;
            if (lane < 0 || lane > 3) return ev;
            return { ...ev, string: UKE_STRINGS[lane] };
          }),
        );
        return;
      }
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        const cur = melody[selected];
        if (!cur) return;
        // Dos dígitos seguidos arman trastes de 10 a 12 (ej: 1 y luego 2 → 12).
        const combinado = Number(String(cur.fret) + e.key);
        const fret = combinado <= MAX_FRET && cur.fret > 0 ? combinado : Number(e.key);
        setMel(melody.map((ev, i) => (i === selected ? { ...ev, fret } : ev)));
        setFretBrush(fret);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, melody, playable, mode, selected]);

  /* ---------- herramientas ---------- */

  /** Copia un compás e inserta la copia justo después, corriendo lo que venga detrás. */
  function duplicateBar(barIndex: number) {
    const from = barIndex * bpb;
    const to = from + bpb;
    const inBar = playable.filter((e) => e.t >= from && e.t < to);
    if (inBar.length === 0) return;
    const shifted = playable.map((e) => (e.t >= to ? { ...e, t: tidy(e.t + bpb) } : e));
    const copy = inBar.map((e) => ({ ...e, t: tidy(e.t + bpb) }));
    setPlayable([...shifted, ...copy]);
    setSelected(null);
  }

  /** Repite la progresión completa N veces (útil para armar una canción entera). */
  function repeatAll(times: number) {
    if (playable.length === 0 || times < 2) return;
    const lenBars = Math.ceil(chartLengthBeats(playable) / bpb);
    const block = lenBars * bpb;
    const out = [...playable];
    for (let k = 1; k < times; k++) {
      playable.forEach((e) => out.push({ ...e, t: tidy(e.t + block * k) }));
    }
    setPlayable(out);
    setSelected(null);
  }

  /** Aplica un patrón de rasgueo a todos los eventos según su lugar en el compás. */
  function applyPattern(p: StrumPattern) {
    setEv(events.map((e) => ({ ...e, dir: dirForBeat(p, e.t % bpb) })));
  }

  /* ---------- acompañamiento grabado ---------- */
  const recordedUrl = song.audio_path ? backingUrl(song.audio_path) : null;

  // Se descarga y decodifica apenas se conoce la URL: para juzgar el calce, la
  // grabación tiene que arrancar en el mismo reloj que el metrónomo.
  useEffect(() => {
    setAudioReady(false);
    if (!recordedUrl) return;
    let alive = true;
    void audio.current
      ?.loadRecorded(recordedUrl)
      .then(() => alive && setAudioReady(true))
      .catch((e) => alive && setError(friendlyError(e)));
    return () => {
      alive = false;
    };
  }, [recordedUrl]);

  /** Un archivo solo se puede borrar si no es el que están escuchando los alumnos. */
  function esElPublicado(path: string | null): boolean {
    return !!path && loaded?.audio_path === path;
  }
  async function borrarSiNoEstaEnVivo(path: string | null) {
    if (path && !esElPublicado(path)) await deleteBacking(path).catch(() => {});
  }

  async function handleUpload(file: File) {
    if (!canEdit) return;
    setUploading(true);
    setError(null);
    try {
      const anterior = song.audio_path;
      const path = await uploadBacking(file, song.slug);
      patch({ audio_path: path });
      // El anterior se borra recién ahora (si la subida falla, no se pierde nada) y
      // solo si no es el que está publicado: ese lo siguen usando los alumnos.
      await borrarSiNoEstaEnVivo(anterior);
      setFlash('Audio subido. Dale a Reproducir y fijate si entra en el tiempo 1.');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setUploading(false);
    }
  }

  async function handleRemoveAudio() {
    if (!song.audio_path) return;
    if (!window.confirm('¿Sacar el acompañamiento grabado? El nivel vuelve al sintetizado.')) return;
    const path = song.audio_path;
    patch({ audio_path: null, audio_offset_s: 0 });
    await borrarSiNoEstaEnVivo(path);
  }

  /* ---------- reproducción ---------- */
  function play(overridePlayable?: ChartEvent[], overrideBacking?: BackingEvent[]) {
    const evs = overridePlayable ?? playable;
    const bck = overrideBacking ?? backingNotes;
    if (evs.length === 0 && bck.length === 0) return;
    // El compás 1 arranca donde termina la anacrusa, no en el tiempo 0.
    const desdeBeat = desdeCompas <= 1 ? 0 : song.pickup_beats + (desdeCompas - 1) * bpb;
    audio.current?.play({
      events: evs.filter((e): e is ChordEvent => 'chord' in e),
      melodyNotes: evs.filter((e): e is MelodyEvent => 'string' in e),
      backingNotes: bck,
      bpm: song.bpm,
      beatsPerBar: bpb,
      chordPcs,
      recordedUrl: audioReady ? recordedUrl : null,
      recordedOffset: song.audio_offset_s,
      pickup: song.pickup_beats,
      desdeBeat,
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
        // La ficha va a borrador: el alumno sigue viendo el título, el BPM y el
        // audio que están publicados hasta que se apriete Publicar.
        await saveSongDraft(sid, song);
      } else {
        // Un nivel nuevo todavía no tiene chart publicado, así que no se ve en la app.
        const created = await insertSong(song);
        sid = created.id;
        setId(sid);
      }

      const existing = loaded?.charts ?? [];
      const draft = await saveDraft(sid, mode, playable, existing, dificultad);
      if (publish) await publishChart(draft.id);

      // El fondo es un chart aparte, con su propia versión y su propio publicado.
      // Solo se toca si hay notas o si ya existía (para poder vaciarlo).
      const hadBacking = existing.some((c) => c.mode === BACKING_MODE);
      if (backingNotes.length > 0 || hadBacking) {
        const bDraft = await saveDraft(sid, BACKING_MODE, backingNotes, existing);
        if (publish) await publishChart(bDraft.id);
      }

      // La ficha se vuelca a las columnas vivas recién acá.
      if (publish) await publishSongMeta(sid);

      const fresh = await getSong(sid);
      setLoaded(fresh);
      setDirty(false);
      setSong(effectiveSong(fresh));
      setFlash(publish ? '🎉 Publicado: ya está en vivo para los alumnos.' : '💾 Borrador guardado (los alumnos todavía no lo ven).');
      await onReload();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleDiscardFicha() {
    if (!id) return;
    if (!window.confirm('¿Descartar los cambios de la ficha y volver a lo publicado?')) return;
    setBusy(true);
    setError(null);
    try {
      await discardSongDraft(id);
      const fresh = await getSong(id);
      setLoaded(fresh);
      setSong(effectiveSong(fresh));
      setFlash('Cambios de la ficha descartados.');
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
      cargarCapas(fresh, mode, dificultad);
      setFlash('Borrador descartado.');
      await onReload();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const selectedChord = mode === 'chords' && selected !== null ? events[selected] : undefined;
  const selectedNote = mode === 'melody' && selected !== null ? melody[selected] : undefined;

  return (
    <div className="stack-16">
      <div className="row">
        <CandyButton tone="ghost" small onClick={salir}>
          ← Volver
        </CandyButton>
        <h2 style={{ fontSize: 22 }}>{id ? song.title || 'Nivel sin título' : 'Nivel nuevo'}</h2>
        {liveChart && <span className="badge live">● En vivo</span>}
        {(hasUnpublishedDraft || fichaEnBorrador) && <span className="badge draft">✎ Borrador sin publicar</span>}
        {dirty && <span className="badge">Cambios sin guardar</span>}
      </div>

      <Steps steps={PASOS} current={paso} onGo={(p) => setPaso(p as typeof paso)} />

      {!canEdit && (
        <div className="notice bad">
          Tu usuario no está habilitado para editar. Podés mirar, pero la base va a rechazar cualquier cambio.
        </div>
      )}
      {error && <div className="notice bad">{error}</div>}
      {flash && <div className="notice good">{flash}</div>}

      {/* ---------- 1 · DATOS DEL NIVEL ---------- */}
      {paso === 'datos' ? (
        <div className="card">
          <div className="row" style={{ marginBottom: 10 }}>
            <div className="section-title grow">Datos del nivel</div>
            {fichaEnBorrador && (
              <>
                <span className="badge draft">✎ Sin publicar</span>
                <CandyButton small tone="ghost" disabled={busy} onClick={() => void handleDiscardFicha()}>
                  Descartar cambios
                </CandyButton>
              </>
            )}
          </div>
          {fichaEnBorrador && (
            <div className="notice warn" style={{ marginBottom: 12 }}>
              Estos datos están guardados como borrador. Los alumnos siguen viendo{' '}
              <b>{loaded?.title}</b> a <b>{loaded?.bpm} BPM</b> hasta que publiques.
            </div>
          )}

          {/* Lo esencial arriba; lo que se toca una vez cada mil, plegado abajo. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <label className="field" style={{ gridColumn: '1 / -1' }}>
              <span>Título</span>
              <input
                className="f"
                value={song.title}
                placeholder="Nivel 5 · Vals"
                onChange={(e) => patchTitulo(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Qué se practica</span>
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
              <span>Compás</span>
              <select className="f" value={song.time_sig} onChange={(e) => patch({ time_sig: e.target.value })}>
                <option value="4/4">4/4</option>
                <option value="3/4">3/4</option>
                <option value="2/4">2/4</option>
                <option value="6/8">6/8</option>
              </select>
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
              <span>Orden en el mapa</span>
              <input
                className="f tnum"
                type="number"
                min={1}
                value={song.level}
                onChange={(e) => patch({ level: Number(e.target.value) })}
              />
            </label>
          </div>

          <p className="muted" style={{ margin: '10px 0 0' }}>
            Si no sabés el compás ni el tempo de la canción, dejalos como están: la IA te los dice
            y se aplican solos.
          </p>

          {/* El camino rápido: una sola pasada y sale el nivel entero. */}
          <div className="notice" style={{ marginTop: 12 }}>
            <div className="row">
              <span className="grow">
                <b>¿Vas a partir de una canción?</b> Pedile a la IA el nivel completo —
                acompañamiento, melodía y acordes— de una sola vez.
              </span>
              <CandyButton tone="sun" onClick={() => setImportTarget('nivel')}>
                ✨ Generar nivel completo
              </CandyButton>
            </div>
          </div>

          <details className="avanzado" style={{ marginTop: 10 }}>
            <summary>▸ Más opciones</summary>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
              <label className="field">
                <span>Identificador (slug)</span>
                <input
                  className="f"
                  value={song.slug}
                  placeholder="se arma solo del título"
                  onChange={(e) => patch({ slug: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Artista</span>
                <input className="f" value={song.artist ?? ''} onChange={(e) => patch({ artist: e.target.value })} />
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
          </details>
        </div>
      ) : (
        // En los demás pasos la ficha se reduce a un renglón: se completa una vez
        // por nivel y no tiene por qué ocupar la primera pantalla siempre.
        <div className="resumen">
          <b>{song.title || 'Nivel sin título'}</b>
          <span className="dato">{mode === 'melody' ? '🎵 Notas' : '🎸 Acordes'}</span>
          <span className="dato">{song.time_sig}</span>
          <span className="dato">{song.bpm} BPM</span>
          <span className="dato">{song.is_free ? 'Gratis' : 'Premium'}</span>
          <div className="grow" />
          <CandyButton small tone="ghost" onClick={() => setPaso('datos')}>
            Editar datos
          </CandyButton>
        </div>
      )}

      {/* ---------- 2 · MÚSICA ---------- */}
      {paso === 'musica' && (
        <>
          {/* El sub-nivel lo impone el juego según cómo progresa el alumno; acá solo
              se elige cuál de los dos se está editando. */}
          <div className="resumen">
            <span className="dato">Etapa {ETAPA_ACTUAL}</span>
            <span className="dato">Editando</span>
            {DIFICULTADES.map((d) => {
              const existe = !!loaded && !!workingChart(loaded, mode, d.id);
              return (
                <CandyButton
                  key={d.id}
                  small
                  tone={dificultad === d.id ? 'grape' : 'ghost'}
                  onClick={() => cambiarDificultad(d.id)}
                  title={d.detalle}
                >
                  {d.label}
                  {existe ? ' ✓' : ''}
                </CandyButton>
              );
            })}
            <span className="muted grow">
              {!workChart
                ? `${DIFICULTADES.find((d) => d.id === dificultad)?.label} todavía está en blanco. El fondo es el mismo para los dos.`
                : `${DIFICULTADES.find((d) => d.id === dificultad)?.detalle} · el alumno no elige, se lo da el juego.`}
            </span>
          </div>

          {/* La dificultad medida, al lado del sub-nivel que la define. */}
          {(playable.length > 0) && (
            <div className="card">
              <div className="section-title" style={{ marginBottom: 10 }}>
                Qué tan difícil es este nivel
              </div>
              <DificultadPanel metricas={metricas} dificultad={dificultad} />
              {perfilIssues.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <Issues issues={perfilIssues} />
                </div>
              )}
            </div>
          )}

          {/* ---------- paleta ---------- */}
          <div className="card">
            <div className="row" style={{ marginBottom: 10 }}>
              <div className="section-title grow">
                {mode === 'melody'
                  ? 'Trastes · elegí uno y hacé clic en la cuerda'
                  : 'Acordes · elegí uno y hacé clic en la grilla'}
              </div>
              <CandyButton small tone="sun" onClick={() => setImportTarget(mode)}>
                ✨ Importar con IA
              </CandyButton>
            </div>
            {mode === 'melody' ? (
              <>
                <div className="fret-palette">
                  {Array.from({ length: MAX_FRET + 1 }, (_, f) => (
                    <button
                      key={f}
                      type="button"
                      className={'fret-chip' + (fretBrush === f ? ' sel' : '')}
                      onClick={() => setFretBrush(f)}
                      title={f === 0 ? 'Cuerda al aire' : `Traste ${f}`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
                <p className="muted" style={{ margin: '8px 0 0' }}>
                  El <b>0</b> es la cuerda al aire. Con una nota seleccionada, los números del teclado le
                  cambian el traste y las flechas ↑↓ la mueven de cuerda.
                </p>
              </>
            ) : (
              <ChordPalette chords={chords} selected={brush} permitidos={acordesPermitidos} onSelect={setBrush} />
            )}
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

            {mode === 'melody' ? (
              <MelodyGrid
                events={melody}
                timeSig={song.time_sig}
                step={step}
                pxPerBeat={pxPerBeat}
                bars={bars}
                defaultDur={defaultDur}
                fretBrush={fretBrush}
                selected={selected}
                cursorBeat={cursorBeat}
                pickup={song.pickup_beats}
                onSelect={setSelected}
                onChange={setMel}
              />
            ) : (
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
                pickup={song.pickup_beats}
                onSelect={setSelected}
                onChange={setEv}
              />
            )}

            {/* ---------- inspector del evento ---------- */}
            <div className="row" style={{ marginTop: 10 }}>
              {selectedChord ? (
                <>
                  <span className="muted">
                    Seleccionado: <b>{selectedChord.chord}</b> · beat {selectedChord.t} · dura {selectedChord.dur}
                  </span>
                  <CandyButton
                    small
                    tone={selectedChord.dir === 'd' ? 'sky' : 'ghost'}
                    onClick={() => setEv(events.map((e, i) => (i === selected ? { ...e, dir: 'd' } : e)))}
                  >
                    ↓ Abajo
                  </CandyButton>
                  <CandyButton
                    small
                    tone={selectedChord.dir === 'u' ? 'sky' : 'ghost'}
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
              ) : selectedNote ? (
                <>
                  <span className="muted">
                    Seleccionada: cuerda <b>{selectedNote.string}</b> traste <b>{selectedNote.fret}</b> · suena{' '}
                    <b>{midiToPitch(STRING_MIDI[selectedNote.string] + selectedNote.fret)}</b> · beat {selectedNote.t}
                  </span>
                  <CandyButton
                    small
                    tone="melon"
                    onClick={() => {
                      setMel(melody.filter((_, i) => i !== selected));
                      setSelected(null);
                    }}
                  >
                    Borrar
                  </CandyButton>
                </>
              ) : (
                <span className="muted">
                  {mode === 'melody'
                    ? 'Clic en una cuerda para colocar · arrastrá el borde derecho para alargar · arrastrá la nota para moverla de cuerda · Supr borra'
                    : 'Clic en la grilla para colocar · arrastrá el borde derecho para alargar · Supr borra · ↑↓ cambia el rasgueo'}
                </span>
              )}
            </div>
          </div>

          {/* ---------- las tres capas alineadas ---------- */}
          {(melody.length > 0 || backingNotes.length > 0) && (
            <div className="card">
              <div className="row" style={{ marginBottom: 10 }}>
                <div className="section-title grow">Las tres capas juntas</div>
                {(() => {
                  const l = largoDeCapas(events, melody, backingNotes);
                  const usadas = [l.acordes, l.melodia, l.fondo].filter((x) => x > 0);
                  const desparejo = usadas.length > 1 && Math.max(...usadas) - Math.min(...usadas) > 0.001;
                  return desparejo ? (
                    <span className="badge draft">
                      ✎ No terminan juntas: acordes {tidy(l.acordes)} · melodía {tidy(l.melodia)} · fondo {tidy(l.fondo)}
                    </span>
                  ) : null;
                })()}
              </div>
              <LevelOverview
                chords={events}
                melody={melody}
                backing={backingNotes}
                timeSig={song.time_sig}
                pxPerBeat={pxPerBeat}
                bars={bars}
                cursorBeat={cursorBeat}
                pickup={song.pickup_beats}
              />
              <p className="muted" style={{ margin: '8px 0 0' }}>
                Para verificar que la armonía calce con la melodía. Si un acorde cambia donde la
                melodía no cambia de nota, casi siempre está corrido.
              </p>
            </div>
          )}

          {/* ---------- atajos de estructura ---------- */}
          <div className="card">
            <div className="section-title" style={{ marginBottom: 10 }}>
              Atajos
            </div>
            {mode === 'chords' && (
              <div className="row">
                <span className="muted">Rasgueo:</span>
                {PATTERNS.map((p) => (
                  <CandyButton key={p.value} small tone="sun" onClick={() => applyPattern(p.value)}>
                    {p.label}
                  </CandyButton>
                ))}
              </div>
            )}
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
        </>
      )}

      {/* ---------- 3 · SONIDO ---------- */}
      {paso === 'sonido' && (
        <>
          {/* ---------- fondo ---------- */}
          <div className="card">
            <div className="row" style={{ marginBottom: 10 }}>
              <div className="section-title grow">
                Fondo · melodía que suena sola (el alumno no la toca)
              </div>
              <CandyButton small tone="sun" onClick={() => setImportTarget('backing')}>
                ✨ Importar con IA
              </CandyButton>
              {backingNotes.length > 0 && (
                <CandyButton
                  small
                  tone="melon"
                  onClick={() => {
                    if (window.confirm('¿Sacar la melodía de fondo de este nivel?')) applyBacking([]);
                  }}
                >
                  Quitar
                </CandyButton>
              )}
            </div>

            {backingNotes.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                Sin acompañamiento. Sirve para que el alumno toque encima de una melodía conocida —
                por ejemplo, pedirle a una IA "Feliz cumpleaños" y poner los acordes arriba.
              </p>
            ) : (
              <>
                <BackingLane
                  notes={backingNotes}
                  pxPerBeat={pxPerBeat}
                  totalBeats={bars * bpb}
                  cursorBeat={cursorBeat}
                />
                <span className="muted">
                  {backingNotes.length} notas · {tidy(chartLengthBeats(backingNotes))} tiempos
                </span>
              </>
            )}
          </div>

          {/* ---------- acompañamiento grabado ---------- */}
          <div className="card">
            <div className="row" style={{ marginBottom: 10 }}>
              <div className="section-title grow">Acompañamiento grabado (reemplaza al sintetizado)</div>
              {song.audio_path && (
                <CandyButton small tone="melon" onClick={() => void handleRemoveAudio()} disabled={!canEdit}>
                  Quitar
                </CandyButton>
              )}
            </div>

            {song.audio_path ? (
              <div className="col">
                <div className="row">
                  <span className="badge live">♪ {audioReady ? 'Listo' : 'Cargando…'}</span>
                  <span className="muted grow" style={{ wordBreak: 'break-all' }}>
                    {song.audio_path}
                  </span>
                </div>
                <div className="row">
                  <span className="muted">Calce:</span>
                  <CandyButton small tone="ghost" onClick={() => patch({ audio_offset_s: tidy(song.audio_offset_s - 0.05) })}>
                    ◀ 50 ms
                  </CandyButton>
                  <input
                    className="f tnum"
                    style={{ width: 96 }}
                    type="number"
                    step={0.01}
                    value={song.audio_offset_s}
                    onChange={(e) => patch({ audio_offset_s: Number(e.target.value) })}
                  />
                  <span className="muted">seg</span>
                  <CandyButton small tone="ghost" onClick={() => patch({ audio_offset_s: tidy(song.audio_offset_s + 0.05) })}>
                    50 ms ▶
                  </CandyButton>
                  <CandyButton small tone="ghost" onClick={() => patch({ audio_offset_s: 0 })}>
                    A cero
                  </CandyButton>
                </div>
                <p className="muted" style={{ margin: 0 }}>
                  Si la música entra <b>tarde</b>, bajá el número; si entra <b>temprano</b>, subilo.
                  Escuchá con el metrónomo prendido: el primer golpe de la grabación tiene que caer
                  junto al primer clic después de la cuenta de entrada.
                </p>
              </div>
            ) : (
              <div className="col">
                <label className="row" style={{ gap: 10 }}>
                  <input
                    type="file"
                    accept="audio/*"
                    disabled={!canEdit || uploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleUpload(f);
                      e.target.value = '';
                    }}
                  />
                  {uploading && <span className="muted">Subiendo…</span>}
                </label>
                <p className="muted" style={{ margin: 0 }}>
                  Subí un audio (mp3, m4a, wav… hasta 20&nbsp;MB) y reemplaza al acompañamiento sintetizado.
                  Tiene que estar a <b>{song.bpm} BPM</b> y arrancar en el <b>tiempo 1</b>, sin cuenta de
                  entrada grabada. Si no calza justo, se ajusta con el control de calce.
                </p>
              </div>
            )}
          </div>

          {/* ---------- qué se escucha ---------- */}
          <div className="card">
            <div className="section-title" style={{ marginBottom: 10 }}>
              Qué se escucha al reproducir
            </div>
            <div className="row">
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
                Entra con un compás de cuenta · {song.bpm} BPM · {tidy(chartLengthBeats(playable))} beats.
                Lo que estás editando <b>suena siempre</b>: estas casillas solo apagan lo que lo acompaña.
              </span>
            </div>
          </div>
        </>
      )}

      {/* ---------- 4 · PUBLICAR ---------- */}
      {paso === 'publicar' && (
        <>
          <div className="card">
            <div className="section-title" style={{ marginBottom: 10 }}>
              Antes de publicar
            </div>
            {allIssues.length === 0 ? (
              <div className="notice good">✓ Todo en orden. El nivel está listo para salir en vivo.</div>
            ) : (
              <Issues issues={allIssues} />
            )}
            <div className="row" style={{ marginTop: 12 }}>
              <span className="muted grow">
                {liveChart ? 'Este nivel ya está en vivo. Publicar reemplaza lo que ven los alumnos.' : 'Este nivel todavía no salió: al publicar aparece en el mapa.'}
              </span>
              {hasUnpublishedDraft && liveChart && (
                <CandyButton tone="ghost" small onClick={() => void handleDiscard()} disabled={busy}>
                  Descartar partitura
                </CandyButton>
              )}
              <CandyButton tone="lime" onClick={() => void persist(true)} disabled={!canEdit || busy || blocked}>
                🚀 Publicar
              </CandyButton>
            </div>
          </div>
          <JsonPanel events={playable} backing={backingNotes} />
        </>
      )}

      {importTarget && (
        <ImportDialog
          target={importTarget}
          title={song.title}
          bpm={song.bpm}
          timeSig={song.time_sig}
          beatsPerBar={bpb}
          bars={bars}
          knownChords={chords.map((c) => c.id)}
          acordesPermitidos={acordesPermitidos}
          modo={mode}
          dificultad={dificultad}
          onDificultad={cambiarDificultad}
          currentChords={events}
          currentMelody={melody}
          currentBacking={backingNotes}
          onPreview={(p, b) =>
            importTarget === 'backing' ? play(playable, b) : play(p, backingNotes)
          }
          onApply={(r) => {
            // El compás y el tempo que propuso la IA se aplican ANTES que los eventos,
            // para que la grilla se dibuje con la medida correcta desde el primer cuadro.
            if (r.setup?.timeSig || r.setup?.bpm || r.setup?.pickup !== undefined) {
              patch({
                ...(r.setup.timeSig ? { time_sig: r.setup.timeSig } : {}),
                ...(r.setup.bpm ? { bpm: r.setup.bpm } : {}),
                // La anacrusa se deduce del primer compás corto: sin guardarla, las
                // barras se dibujan cada N desde cero y todo se ve corrido.
                pickup_beats: r.setup.pickup ?? 0,
              });
            }
            if (importTarget === 'nivel') {
              // EL TIPO DE NIVEL NO SE DEDUCE DE LO QUE DEVUELVA LA IA. Antes sí, y
              // como el pedido siempre incluía acordes, siempre salía un nivel de
              // acordes: no había forma de crear uno de notas. Ahora lo elegiste vos
              // en el listado y acá solo se reparte lo que llegó según esa decisión.
              if (mode === 'chords') {
                setEv(r.chords ?? []);
                setMel([]);
                // La melodía no se toca en este nivel pero tiene que SONAR: va al
                // fondo marcada como 'lead' para destacarse sobre el relleno.
                const melodiaComoFondo: BackingEvent[] = (r.melody ?? []).map((n) => ({
                  t: n.t,
                  pitch: midiToPitch(STRING_MIDI[n.string] + n.fret),
                  dur: n.dur,
                  v: 'lead' as const,
                }));
                applyBacking([...(r.backing ?? []), ...melodiaComoFondo]);
              } else {
                // Nivel de notas: la melodía es lo jugable. Si la IA mandó acordes
                // igual, se descartan — la armonía ya la sostiene el acompañamiento.
                setMel(r.melody ?? []);
                setEv([]);
                applyBacking(r.backing ?? []);
              }
            } else {
              if (r.chords) setEv(r.chords);
              if (r.melody) setMel(r.melody);
              if (r.backing) applyBacking(r.backing);
            }
            setSelected(null);
            setImportTarget(null);
            setPaso('musica');
            stop();
          }}
          onClose={() => {
            setImportTarget(null);
            stop();
          }}
        />
      )}

      {/* Los errores del paso actual se ven donde ocurren, no todos juntos al final. */}
      {paso !== 'publicar' && (
        <Issues
          issues={
            paso === 'datos' ? songIssues : paso === 'musica' ? chartIssues : backingIssues
          }
        />
      )}

      {/* ---------- barra fija: siempre a mano, sin scrollear ---------- */}
      <div className="actionbar">
        <CandyButton
          tone="lime"
          small
          onClick={() => play()}
          disabled={playable.length === 0 && backingNotes.length === 0}
        >
          ▶ Escuchar
        </CandyButton>
        <CandyButton tone="ghost" small onClick={stop}>
          ■
        </CandyButton>
        <label className="row" style={{ gap: 6 }}>
          <span className="muted">desde el compás</span>
          <select
            className="f tnum"
            style={{ width: 74 }}
            value={Math.min(desdeCompas, bars)}
            onChange={(e) => setDesdeCompas(Number(e.target.value))}
          >
            {Array.from({ length: bars }, (_, i) => (
              <option key={i} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
        </label>
        <CandyButton
          tone="sun"
          small
          onClick={() => void persist(false)}
          disabled={!canEdit || busy || hasErrors(songIssues)}
        >
          💾 Guardar borrador
        </CandyButton>

        <div className="grow" />

        {pasoIdx > 0 && (
          <CandyButton tone="ghost" small onClick={() => setPaso(PASOS[pasoIdx - 1].id as typeof paso)}>
            ← {PASOS[pasoIdx - 1].label}
          </CandyButton>
        )}
        {pasoIdx < PASOS.length - 1 && (
          <CandyButton tone="sky" small onClick={() => setPaso(PASOS[pasoIdx + 1].id as typeof paso)}>
            {PASOS[pasoIdx + 1].label} →
          </CandyButton>
        )}
      </div>
    </div>
  );
}
