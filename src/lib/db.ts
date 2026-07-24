/* Todas las consultas a Supabase en un solo lugar. */

import { supabase } from './supabase';
import { parseEvents, serializeEvents } from './chartFormat';
import type { ChartEvent, ChartMode, Song } from './chartFormat';

export interface ChordRow {
  id: string;
  name_es: string;
  frets: number[];
  fingers: number[];
  pitch_classes: number[];
}

export interface ChartRow {
  id: string;
  song_id: string;
  mode: ChartMode;
  version: number;
  events: ChartEvent[];
  published: boolean;
}

export interface SongRow extends Song {
  id: string;
  charts: ChartRow[];
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
  is_free: true,
  duration_s: null,
};

/* ---------------- Acordes ---------------- */

export async function listChords(): Promise<ChordRow[]> {
  const { data, error } = await supabase.from('chords').select('*').order('id');
  if (error) throw error;
  return (data ?? []) as ChordRow[];
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
    charts: (r.charts ?? []).map((c) => ({ ...c, events: parseEvents(c.events) })),
  };
}

export async function insertSong(song: Song): Promise<SongRow> {
  const { data, error } = await supabase.from('songs').insert(stripSong(song)).select().single();
  if (error) throw error;
  return { ...normalizeSongRow(data), charts: [] };
}

export async function updateSong(id: string, song: Song): Promise<void> {
  const { error } = await supabase.from('songs').update(stripSong(song)).eq('id', id);
  if (error) throw error;
}

export async function deleteSong(id: string): Promise<void> {
  // Los charts se borran primero: la FK charts.song_id no tiene cascade.
  const { error: cErr } = await supabase.from('charts').delete().eq('song_id', id);
  if (cErr) throw cErr;
  const { error } = await supabase.from('songs').delete().eq('id', id);
  if (error) throw error;
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
  mode: ChartMode,
  events: ChartEvent[],
  existingCharts: ChartRow[],
): Promise<ChartRow> {
  const clean = serializeEvents(events);
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
  return { ...(data as ChartRow), events: parseEvents((data as ChartRow).events) };
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

  const created = await insertSong({
    ...source,
    slug,
    title: `${source.title} (copia)`,
  });

  // Se copia el chart que está en vivo; si no hay, el borrador más nuevo.
  const src =
    source.charts.find((c) => c.published) ??
    [...source.charts].sort((a, b) => b.version - a.version)[0];

  if (src) {
    const { error } = await supabase.from('charts').insert({
      song_id: created.id,
      mode: src.mode,
      version: 1,
      events: serializeEvents(src.events),
      published: false, // la copia arranca como borrador: no aparece en la app de alumnos
    });
    if (error) throw error;
  }
  return getSong(created.id);
}

/* ---------------- Ayudas ---------------- */

/** El chart que está editando el editor: el borrador si existe, si no el publicado. */
export function workingChart(song: SongRow, mode: ChartMode): ChartRow | null {
  const same = song.charts.filter((c) => c.mode === mode);
  const draft = same.filter((c) => !c.published).sort((a, b) => b.version - a.version)[0];
  return draft ?? same.find((c) => c.published) ?? null;
}

export function publishedChart(song: SongRow, mode: ChartMode): ChartRow | null {
  return song.charts.find((c) => c.mode === mode && c.published) ?? null;
}

/** El modo de un nivel: el del chart que tenga. Por defecto, acordes. */
export function songMode(song: SongRow): ChartMode {
  return song.charts[0]?.mode ?? 'chords';
}
