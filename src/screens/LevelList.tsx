import { useState } from 'react';
import { CandyButton } from '../components/CandyButton';
import { deleteSong, duplicateSong, hasSongDraft, playableChart, songDifficulty, songMode } from '../lib/db';
import type { ChartRow, SongRow } from '../lib/db';
import { DIFICULTADES, ETAPA_ACTUAL } from '../lib/chartFormat';
import type { ChartMode } from '../lib/chartFormat';
import { medirAcordes, medirMelodia } from '../lib/dificultad';
import type { Digitaciones } from '../lib/dificultad';
import { friendlyError } from '../lib/supabase';

interface Props {
  songs: SongRow[];
  /** Digitaciones, para poder medir la dificultad de cada fila. */
  digitaciones: Digitaciones;
  canEdit: boolean;
  /** Al crear, el tipo va decidido desde acá: es por dónde se entra. */
  onOpen: (songId: string | null, nuevoModo?: ChartMode) => void;
  onReload: (songId?: string) => Promise<void>;
}

type State = 'live' | 'draft' | 'changed';

/**
 * El estado se calcula sobre el chart jugable que la canción TENGA, sin
 * preguntar por un sub-nivel concreto. Preguntar siempre por el primero hacía
 * que una canción creada en el otro apareciera como borrador vacío aunque
 * estuviera publicada y en vivo.
 */
function stateOf(song: SongRow): State {
  const chart = playableChart(song);
  if (!chart) return 'draft';
  if (!chart.published) return song.charts.some((c) => c.published) ? 'changed' : 'draft';
  if (hasSongDraft(song)) return 'changed';
  return 'live';
}

/** Los dos currículos. Cada uno es un camino aparte, con su propia puerta de entrada. */
const GRUPOS: { mode: ChartMode; titulo: string; crear: string; vacio: string }[] = [
  {
    mode: 'chords',
    titulo: '🎸 Acordes',
    crear: '+ Nivel de acordes',
    vacio: 'Todavía no hay niveles de acordes.',
  },
  {
    mode: 'melody',
    titulo: '🎵 Notas',
    crear: '+ Nivel de notas',
    vacio: 'Todavía no hay niveles de notas. El alumno toca la melodía en la tablatura.',
  },
];

/**
 * La dificultad de un vistazo. Existe porque los tres niveles de acordes que
 * había publicados daban todos lo mismo —4 acordes, ~18 cambios por minuto— y
 * desde el listado no había forma de notarlo.
 */
function resumenDificultad(song: SongRow, chart: ChartRow | null, dig: Digitaciones): string {
  if (!chart || chart.events.length === 0) return 'sin eventos';
  if (chart.mode === 'melody') {
    const m = medirMelodia(chart.events.filter((e) => 'string' in e) as never, song.bpm);
    return `${m.posiciones} posiciones · traste máx ${m.trasteMax} · ${m.notasPorMinuto} notas/min`;
  }
  const m = medirAcordes(chart.events.filter((e) => 'chord' in e) as never, dig, song.bpm, song.time_sig);
  return `${m.distintos.join(' ')} · ${m.cambiosPorMinuto} cambios/min · ${m.dedosPorCambio} dedos`;
}

const STATE_LABEL: Record<State, { text: string; cls: string }> = {
  live: { text: '● En vivo', cls: 'badge live' },
  draft: { text: '✎ Borrador', cls: 'badge draft' },
  changed: { text: '✎ Sin publicar', cls: 'badge draft' },
};

export function LevelList({ songs, digitaciones, canEdit, onOpen, onReload }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDuplicate(song: SongRow) {
    setBusy(song.id);
    setError(null);
    try {
      const copy = await duplicateSong(song);
      await onReload();
      onOpen(copy.id);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(song: SongRow) {
    const ok = window.confirm(
      `¿Borrar "${song.title}" y su chart?\n\nSi está en vivo, desaparece de la app de alumnos. No se puede deshacer.`,
    );
    if (!ok) return;
    setBusy(song.id);
    setError(null);
    try {
      await deleteSong(song.id);
      await onReload();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack-16">
      <div className="row">
        <h2 style={{ fontSize: 24 }}>Niveles</h2>
        <span className="muted">
          {songs.length} en total · etapa {ETAPA_ACTUAL}
        </span>
      </div>

      {error && <div className="notice bad">{error}</div>}

      {/* Los dos currículos son caminos paralelos, así que se leen mejor uno al
          lado del otro. En pantalla angosta se apilan solos. */}
      <div className="grupos">
        {GRUPOS.map(({ mode: gm, titulo, crear, vacio }) => {
          const delGrupo = songs.filter((s) => songMode(s) === gm);
          return (
            <div key={gm} className="grupo">
              <div className="row">
                <h3 className="group-title">{titulo}</h3>
                <span className="muted">
                  {delGrupo.length === 0
                    ? 'ninguno'
                    : `${delGrupo.length} ${delGrupo.length === 1 ? 'nivel' : 'niveles'}`}
                </span>
                <div className="grow" />
                {/* El tipo se decide acá, en el primer clic. Antes había un solo
                    botón arriba de todo y siempre nacía un nivel de acordes. */}
                <CandyButton small tone="lime" disabled={!canEdit} onClick={() => onOpen(null, gm)}>
                  {crear}
                </CandyButton>
              </div>

              {delGrupo.length === 0 ? (
                <div className="notice">{vacio}</div>
              ) : (
                delGrupo.map((s) => {
                  const chart = playableChart(s);
                  const label = STATE_LABEL[stateOf(s)];
                  return (
                    <div key={s.id} className="nivel">
                      <div className="row">
                        <div className="lv-title grow">{s.title || 'Sin título'}</div>
                        <span className={label.cls}>{label.text}</span>
                      </div>
                      <div className="row" style={{ gap: 7 }}>
                        <span className="badge sub">
                          {DIFICULTADES.find((d) => d.id === songDifficulty(s))?.label}
                        </span>
                        <span className="muted tnum">nivel {s.level}</span>
                        <span className="muted tnum">{s.bpm} BPM</span>
                        <span className="muted">{s.time_sig}</span>
                        <span className="muted">{s.is_free ? 'Gratis' : 'Premium'}</span>
                      </div>
                      <div className="muted">{resumenDificultad(s, chart, digitaciones)}</div>
                      <div className="row" style={{ gap: 6 }}>
                        <CandyButton small tone="sky" onClick={() => onOpen(s.id)}>
                          Editar
                        </CandyButton>
                        <CandyButton
                          small
                          tone="ghost"
                          disabled={!canEdit || busy === s.id}
                          onClick={() => void handleDuplicate(s)}
                        >
                          Duplicar
                        </CandyButton>
                        <CandyButton
                          small
                          tone="melon"
                          disabled={!canEdit || busy === s.id}
                          onClick={() => void handleDelete(s)}
                        >
                          Borrar
                        </CandyButton>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          );
        })}
      </div>

      <p className="muted">
        Los niveles en <b>borrador</b> no aparecen en la app de alumnos hasta que los publiques.
      </p>
    </div>
  );
}
