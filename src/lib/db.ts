/* Todas las consultas a Supabase en un solo lugar. */

import { supabase } from './supabase';
import { BACKING_MODE, parseBacking, parseEvents, serializeBacking, serializeEvents } from './chartFormat';
import type { AnyChartMode, BackingEvent, ChartEvent, ChartMode, Song } from './chartFormat';

export interface ChordRow {
  id: string;
  name_es: string;
  frets: number[];
  fingers: number[];
  /** Notas del acorde. Es lo que usa el motor de audio para detectarlo. */
  pitch_classes: number[];
  /** Un peso por pitch class, en la misma posición. */
  weights: number[];
  sort_order: number;
}

export interface ChartRow {
  id: string;
  song_id: string;
  mode: AnyChartMode;
  version: number;
  published: boolean;
  /** Eventos jugables. Vacío cuando el chart es la capa de fondo. */
  events: ChartEvent[];
  /** Notas del acompañamiento. Vacío salvo que el modo sea 'backing'. */
  backing: BackingEvent[];
}

export interface SongRow extends Song {
  id: string;
  charts: ChartRow[];
  /** Cambios de la ficha sin publicar. Las columnas de al lado son lo que ve el alumno. */
  draft: Partial<Song> | null;
}

/** La ficha tal como se ve en el editor: lo publicado con el borrador encima. */
export function effectiveSong(row: SongRow): Song {
  return { ...stripSong(row), ...(row.draft ?? {}) } as Song;
}

/** ¿La ficha tiene cambios que el alumno todavía no ve? */
export function hasSongDraft(row: SongRow): boolean {
  return row.draft !== null && row.draft !== undefined;
}

export const EMPTY_SONG: Song = {
  slug: '',
  title: '',
  artist: null,
  level: 1,
  bpm: 80,
  time_sig: '4/4',
  tuning: 'GCEA',
  audio_path: null,
  audio_offset_s: 0,
  is_free: true,
  duration_s: null,
};

/* ---------------- Acompañamiento grabado (Storage) ---------------- */

const BUCKET = 'backing';

export function backingUrl(path: string): string {
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Sube el archivo con un nombre derivado del slug. Devuelve la ruta a guardar en songs. */
export async function uploadBacking(file: File, slug: string): Promise<string> {
  const ext = (file.name.split('.').pop() || 'mp3').toLowerCase();
  // El sufijo con la hora evita que quede cacheado el archivo anterior al reemplazarlo.
  const path = `${slug || 'nivel'}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'audio/mpeg',
    upsert: false,
  });
  if (error) throw error;
  return path;
}

export async function deleteBacking(path: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}

/* ---------------- Acordes ---------------- */

export async function listChords(): Promise<ChordRow[]> {
  const { data, error } = await supabase
    .from('chords')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((c) => ({
    ...(c as ChordRow),
    weights: ((c as ChordRow).weights ?? []).map(Number),
  }));
}

export async function upsertChord(row: ChordRow): Promise<void> {
  const { error } = await supabase.from('chords').upsert({
    id: row.id.trim(),
    name_es: row.name_es.trim(),
    frets: row.frets,
    fingers: row.fingers,
    pitch_classes: row.pitch_classes,
    weights: row.weights,
    sort_order: row.sort_order,
  });
  if (error) throw error;
}

export async function deleteChord(id: string): Promise<void> {
  const { error } = await supabase.from('chords').delete().eq('id', id);
  if (error) throw error;
}

/** En qué niveles se usa un acorde. Borrarlo sin mirar esto rompe esos niveles. */
export function chordUsage(songs: SongRow[], chordId: string): string[] {
  const out: string[] = [];
  for (const s of songs) {
    const usa = s.charts.some(
      (c) => c.mode !== BACKING_MODE && c.events.some((e) => 'chord' in e && e.chord === chordId),
    );
    if (usa) out.push(s.title);
  }
  return out;
}

/* ---------------- Canciones ---------------- */

export async function listSongs(): Promise<SongRow[]> {
  const { data, error } = await supabase
    .from('songs')
    .select('*, charts(id, song_id, mode, version, events, published)')
    .order('level', { ascending: true })
    .order('title', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(normalizeSongRow);
}

export async function getSong(id: string): Promise<SongRow> {
  const { data, error } = await supabase
    .from('songs')
    .select('*, charts(id, song_id, mode, version, events, published)')
    .eq('id', id)
    .single();
  if (error) throw error;
  return normalizeSongRow(data);
}

function normalizeSongRow(raw: unknown): SongRow {
  const r = raw as SongRow & { bpm: unknown; charts?: ChartRow[] };
  return {
    ...r,
    bpm: Number(r.bpm),
    audio_offset_s: Number(r.audio_offset_s) || 0,
    draft: r.draft ?? null,
    charts: (r.charts ?? []).map((c) => ({
      ...c,
      // El mismo campo jsonb guarda dos formas distintas según el modo.
      events: c.mode === BACKING_MODE ? [] : parseEvents(c.events),
      backing: c.mode === BACKING_MODE ? parseBacking(c.events) : [],
    })),
  };
}

/** Un nivel nuevo todavía no tiene chart publicado, así que no se ve en la app:
 *  se puede escribir directo en las columnas. El borrador arranca vacío. */
export async function insertSong(song: Song): Promise<SongRow> {
  const { data, error } = await supabase
    .from('songs')
    .insert({ ...stripSong(song), draft: null })
    .select()
    .single();
  if (error) throw error;
  return { ...normalizeSongRow(data), charts: [] };
}

/**
 * Guarda la ficha COMO BORRADOR: las columnas vivas no se tocan, así que el alumno
 * sigue viendo lo publicado. Se vuelca recién con publishSongMeta.
 */
export async function saveSongDraft(id: string, song: Song): Promise<void> {
  const { error } = await supabase.from('songs').update({ draft: stripSong(song) }).eq('id', id);
  if (error) throw error;
}

/** Vuelca el borrador de la ficha a las columnas vivas y lo limpia, en una transacción. */
export async function publishSongMeta(id: string): Promise<void> {
  const { error } = await supabase.rpc('publish_song_meta', { p_song_id: id });
  if (error) throw error;
}

/** Tira los cambios de la ficha y vuelve a lo publicado. */
export async function discardSongDraft(id: string): Promise<void> {
  const { error } = await supabase.from('songs').update({ draft: null }).eq('id', id);
  if (error) throw error;
}

export async function deleteSong(id: string): Promise<void> {
  // Se junta el audio antes de borrar la fila: después ya no se sabe cuál era.
  const { data } = await supabase.from('songs').select('audio_path, draft').eq('id', id).single();
  const paths = [
    (data as { audio_path?: string } | null)?.audio_path,
    (data as { draft?: { audio_path?: string } } | null)?.draft?.audio_path,
  ].filter((p): p is string => !!p);

  const { error: cErr } = await supabase.from('charts').delete().eq('song_id', id);
  if (cErr) throw cErr;
  const { error } = await supabase.from('songs').delete().eq('id', id);
  if (error) throw error;

  // Si esto falla, el nivel igual quedó borrado: el archivo suelto no rompe nada.
  if (paths.length) await supabase.storage.from(BUCKET).remove([...new Set(paths)]).catch(() => {});
}

function stripSong(s: Song) {
  return {
    slug: s.slug.trim(),
    title: s.title.trim(),
    artist: s.artist?.trim() || null,
    level: s.level,
    bpm: s.bpm,
    time_sig: s.time_sig,
    tuning: s.tuning,
    audio_path: s.audio_path || null,
    audio_offset_s: Number(s.audio_offset_s) || 0,
    is_free: s.is_free,
    duration_s: s.duration_s,
  };
}

/* ---------------- Charts ---------------- */

/**
 * Guarda un borrador (published = false).
 * Si ya hay un borrador para esa canción y modo lo pisa; si no, crea una versión nueva
 * por encima de la última, así el chart publicado nunca se toca mientras se edita.
 */
export async function saveDraft(
  songId: string,
  mode: AnyChartMode,
  events: ChartEvent[] | BackingEvent[],
  existingCharts: ChartRow[],
): Promise<ChartRow> {
  const clean =
    mode === BACKING_MODE
      ? serializeBacking(events as BackingEvent[])
      : serializeEvents(events as ChartEvent[]);
  const sameMode = existingCharts.filter((c) => c.mode === mode);
  const draft = sameMode.filter((c) => !c.published).sort((a, b) => b.version - a.version)[0];

  if (draft) {
    const { data, error } = await supabase
      .from('charts')
      .update({ events: clean })
      .eq('id', draft.id)
      .select()
      .single();
    if (error) throw error;
    return { ...(data as ChartRow), events: parseEvents((data as ChartRow).events) };
  }

  const nextVersion = sameMode.reduce((m, c) => Math.max(m, c.version), 0) + 1;
  const { data, error } = await supabase
    .from('charts')
    .insert({ song_id: songId, mode, version: nextVersion, events: clean, published: false })
    .select()
    .single();
  if (error) throw error;
  return normalizeChartRow(data);
}

function normalizeChartRow(raw: unknown): ChartRow {
  const c = raw as ChartRow;
  return {
    ...c,
    events: c.mode === BACKING_MODE ? [] : parseEvents(c.events),
    backing: c.mode === BACKING_MODE ? parseBacking(c.events) : [],
  };
}

/** Pone un chart en vivo. La función de la base baja el anterior en la misma transacción. */
export async function publishChart(chartId: string): Promise<void> {
  const { error } = await supabase.rpc('publish_chart', { p_chart_id: chartId });
  if (error) throw error;
}

/** Vuelve al estado publicado: descarta el borrador de esa canción y modo. */
export async function discardDraft(chartId: string): Promise<void> {
  const { error } = await supabase.from('charts').delete().eq('id', chartId).eq('published', false);
  if (error) throw error;
}

/* ---------------- Duplicar ---------------- */

/** La mayoría de los niveles nuevos nacen como variante de otro. */
export async function duplicateSong(source: SongRow): Promise<SongRow> {
  const existing = await listSongs();
  const slugs = new Set(existing.map((s) => s.slug));
  let slug = `${source.slug}-copia`;
  let n = 2;
  while (slugs.has(slug)) slug = `${source.slug}-copia-${n++}`;

  // Se copia la ficha efectiva (con el borrador aplicado): es lo que el autor ve.
  const base = effectiveSong(source);
  const created = await insertSong({
    ...base,
    slug,
    title: `${base.title} (copia)`,
    // El audio no se duplica: el archivo es el mismo y borrar la copia se llevaría
    // el original. Si la copia lo necesita, se vuelve a subir.
    audio_path: null,
    audio_offset_s: 0,
  });

  // Se copian todas las capas del nivel (lo jugable y el fondo). De cada una,
  // la que está en vivo; si no hay, el borrador más nuevo.
  const modes = [...new Set(source.charts.map((c) => c.mode))];
  const rows = modes
    .map((mode) => {
      const same = source.charts.filter((c) => c.mode === mode);
      const src = same.find((c) => c.published) ?? [...same].sort((a, b) => b.version - a.version)[0];
      if (!src) return null;
      return {
        song_id: created.id,
        mode,
        version: 1,
        events: mode === BACKING_MODE ? serializeBacking(src.backing) : serializeEvents(src.events),
        published: false, // la copia arranca como borrador: no aparece en la app de alumnos
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length > 0) {
    const { error } = await supabase.from('charts').insert(rows);
    if (error) throw error;
  }
  return getSong(created.id);
}

/* ---------------- Ayudas ---------------- */

/** El chart que está editando el editor: el borrador si existe, si no el publicado. */
export function workingChart(song: SongRow, mode: AnyChartMode): ChartRow | null {
  const same = song.charts.filter((c) => c.mode === mode);
  const draft = same.filter((c) => !c.published).sort((a, b) => b.version - a.version)[0];
  return draft ?? same.find((c) => c.published) ?? null;
}

export function publishedChart(song: SongRow, mode: AnyChartMode): ChartRow | null {
  return song.charts.find((c) => c.mode === mode && c.published) ?? null;
}

/**
 * El modo JUGABLE de un nivel. Ojo: hay que ignorar la capa de fondo, porque
 * un nivel puede tener las dos y el fondo no es lo que toca el alumno.
 */
export function songMode(song: SongRow): ChartMode {
  const playable = song.charts.find((c) => c.mode !== BACKING_MODE);
  return (playable?.mode as ChartMode) ?? 'chords';
}

/** ¿Este nivel tiene acompañamiento cargado? */
export function hasBacking(song: SongRow): boolean {
  return song.charts.some((c) => c.mode === BACKING_MODE && c.backing.length > 0);
}
