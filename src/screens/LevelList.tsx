import { useState } from 'react';
import { CandyButton } from '../components/CandyButton';
import { deleteSong, duplicateSong, hasSongDraft, publishedChart, songMode, workingChart } from '../lib/db';
import type { SongRow } from '../lib/db';
import { friendlyError } from '../lib/supabase';

interface Props {
  songs: SongRow[];
  canEdit: boolean;
  onOpen: (songId: string | null) => void;
  onReload: () => Promise<void>;
}

type State = 'live' | 'draft' | 'changed';

function stateOf(song: SongRow): State {
  const mode = songMode(song);
  const live = publishedChart(song, mode);
  const work = workingChart(song, mode);
  if (!live) return 'draft';
  // Cuenta como "sin publicar" tanto un chart nuevo como cambios en la ficha.
  if (hasSongDraft(song)) return 'changed';
  if (work && work.id !== live.id) return 'changed';
  return 'live';
}

/** Los dos currículos, en el mismo orden en que los ofrece la app de alumnos. */
const GRUPOS = [
  { mode: 'chords' as const, titulo: '🎸 Acordes', sub: 'todavía ninguno' },
  { mode: 'melody' as const, titulo: '🎵 Notas', sub: 'todavía ninguno' },
];

const STATE_LABEL: Record<State, { text: string; cls: string }> = {
  live: { text: '● En vivo', cls: 'badge live' },
  draft: { text: '✎ Borrador', cls: 'badge draft' },
  changed: { text: '✎ Cambios sin publicar', cls: 'badge draft' },
};

export function LevelList({ songs, canEdit, onOpen, onReload }: Props) {
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
        <span className="muted">{songs.length} en total</span>
        <div className="grow" />
        <CandyButton tone="lime" onClick={() => onOpen(null)} disabled={!canEdit}>
          + Nivel nuevo
        </CandyButton>
      </div>

      {error && <div className="notice bad">{error}</div>}

      {songs.length === 0 ? (
        <div className="notice">Todavía no hay niveles cargados.</div>
      ) : (
        // Acordes y notas son dos currículos distintos: entreverados obligan a leer
        // la columna "Modo" en cada fila para saber qué se está mirando.
        GRUPOS.map(({ mode: gm, titulo, sub }) => {
          const delGrupo = songs.filter((s) => songMode(s) === gm);
          return (
            <div key={gm} className="stack-16">
              <div className="row" style={{ marginTop: 6 }}>
                <h3 className="group-title">{titulo}</h3>
                <span className="muted">
                  {delGrupo.length === 0 ? sub : `${delGrupo.length} ${delGrupo.length === 1 ? 'nivel' : 'niveles'}`}
                </span>
              </div>
              {delGrupo.length === 0 ? (
                <div className="notice">Todavía no hay niveles de este tipo.</div>
              ) : (
                <table className="levels">
                  <thead>
                    <tr>
                      <th>Nivel</th>
                      <th>BPM</th>
                      <th>Eventos</th>
                      <th>Acceso</th>
                      <th>Estado</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {delGrupo.map((s) => {
                      const mode = songMode(s);
                      const work = workingChart(s, mode);
                      const st = stateOf(s);
                      const label = STATE_LABEL[st];
                      return (
                        <tr key={s.id}>
                          <td>
                            <div className="lv-title">{s.title}</div>
                            <div className="muted">
                              nivel {s.level} · {s.slug}
                            </div>
                          </td>
                          <td className="tnum">{s.bpm}</td>
                          <td className="tnum">{work ? work.events.length : 0}</td>
                          <td>{s.is_free ? 'Gratis' : 'Premium'}</td>
                          <td>
                            <span className={label.cls}>{label.text}</span>
                          </td>
                          <td>
                            <span className="row-actions">
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
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        })
      )}

      <p className="muted">
        Los niveles en <b>borrador</b> no aparecen en la app de alumnos hasta que los publiques.
      </p>
    </div>
  );
}
