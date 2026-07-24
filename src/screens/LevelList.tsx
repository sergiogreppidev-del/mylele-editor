import { useState } from 'react';
import { CandyButton } from '../components/CandyButton';
import { deleteSong, duplicateSong, publishedChart, songMode, workingChart } from '../lib/db';
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
  if (work && work.id !== live.id) return 'changed';
  return 'live';
}

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
        <table className="levels">
          <thead>
            <tr>
              <th>Nivel</th>
              <th>Modo</th>
              <th>BPM</th>
              <th>Eventos</th>
              <th>Acceso</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {songs.map((s) => {
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
                  <td>
                    <span className="badge mode">{mode === 'melody' ? '🎵 Notas' : '🎸 Acordes'}</span>
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

      <p className="muted">
        Los niveles en <b>borrador</b> no aparecen en la app de alumnos hasta que los publiques.
      </p>
    </div>
  );
}
