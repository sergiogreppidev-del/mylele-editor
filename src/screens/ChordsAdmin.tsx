import { useMemo, useState } from 'react';
import { CandyButton } from '../components/CandyButton';
import { ChordDiagram } from '../components/ChordDiagram';
import { Issues } from '../components/Issues';
import { chordColor } from '../lib/colors';
import { hasErrors } from '../lib/chartFormat';
import { parseChordName, pcName, suggestFingers, validateChordShape } from '../lib/chordTheory';
import { chordUsage, deleteChord, upsertChord } from '../lib/db';
import type { ChordRow, SongRow } from '../lib/db';
import { friendlyError } from '../lib/supabase';

interface Props {
  chords: ChordRow[];
  songs: SongRow[];
  canEdit: boolean;
  onBack: () => void;
  onReload: () => Promise<void>;
}

const VACIO: ChordRow = {
  id: '', name_es: '', frets: [0, 0, 0, 0], fingers: [0, 0, 0, 0],
  pitch_classes: [], weights: [], sort_order: 100,
};

/** ¿Los pesos guardados difieren de los que saldrían del nombre? Entonces los midió alguien. */
function calibradoAMano(guardados: number[], delNombre: number[]): boolean {
  if (guardados.length !== delNombre.length) return false;
  return guardados.some((w, i) => Math.abs(w - delNombre[i]) > 0.001);
}

export function ChordsAdmin({ chords, songs, canEdit, onBack, onReload }: Props) {
  const [editing, setEditing] = useState<ChordRow | null>(null);
  /** true = es un acorde nuevo, así el id todavía se puede escribir. */
  const [isNew, setIsNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const parsed = useMemo(() => (editing ? parseChordName(editing.id) : null), [editing]);
  const issues = useMemo(
    () => (editing && editing.id ? validateChordShape(editing.id, editing.frets) : []),
    [editing],
  );
  const blocked = hasErrors(issues) || !editing?.id || !parsed;

  function empezarNuevo() {
    const ultimo = chords.length ? chords[chords.length - 1].sort_order : 0;
    setEditing({ ...VACIO, sort_order: ultimo + 10 });
    setIsNew(true);
    setError(null);
    setFlash(null);
  }

  function patch(next: Partial<ChordRow>) {
    setEditing((c) => (c ? { ...c, ...next } : c));
  }

  /** Al cambiar el nombre se rellenan solos el nombre en castellano y las notas. */
  function cambiarId(id: string) {
    const p = parseChordName(id);
    setEditing((c) =>
      c
        ? {
            ...c,
            id,
            name_es: !c.name_es || isNew ? (p?.nombreEs ?? '') : c.name_es,
            pitch_classes: p?.pitchClasses ?? [],
            weights: p?.weights ?? [],
          }
        : c,
    );
  }

  function cambiarTraste(i: number, fret: number) {
    setEditing((c) => {
      if (!c) return c;
      const frets = [...c.frets];
      frets[i] = fret;
      return { ...c, frets, fingers: suggestFingers(frets) };
    });
  }

  async function guardar() {
    if (!editing || !canEdit || blocked) return;
    setBusy(true);
    setError(null);
    try {
      // Las NOTAS se recalculan del nombre, por si el acorde se escribió después de
      // tocar los trastes. Los PESOS no: solo se generan para un acorde nuevo.
      //
      // Los pesos del G están calibrados contra grabaciones reales —exigen su tercera
      // y bajan el D, lo que llevó la detección de 10 aciertos sobre 39 a 38 sobre 39—
      // y son distintos de los que sale del nombre. Recalcularlos al guardar borraba
      // esa medición de un clic, y el síntoma (el C detectándose como G) aparecía
      // recién cuando alguien tocaba con un ukelele de verdad.
      const p = parseChordName(editing.id)!;
      const pesosDesparejos = editing.weights.length !== p.pitchClasses.length;
      await upsertChord({
        ...editing,
        pitch_classes: p.pitchClasses,
        weights: isNew || pesosDesparejos ? p.weights : editing.weights,
      });
      await onReload();
      setFlash(`Acorde ${editing.id} guardado. Probalo con el ukelele antes de usarlo en un nivel.`);
      setEditing(null);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function borrar(c: ChordRow) {
    const usos = chordUsage(songs, c.id);
    if (usos.length) {
      setError(
        `No se puede borrar ${c.id}: lo usan ${usos.length} ${usos.length === 1 ? 'nivel' : 'niveles'} (${usos.join(', ')}). Sacalo de ahí primero.`,
      );
      return;
    }
    if (!window.confirm(`¿Borrar el acorde ${c.id}?`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteChord(c.id);
      await onReload();
      setFlash(`Acorde ${c.id} borrado.`);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-16">
      <div className="row">
        <CandyButton tone="ghost" small onClick={onBack}>
          ← Volver
        </CandyButton>
        <h2 style={{ fontSize: 24 }}>Acordes</h2>
        <span className="muted">{chords.length} cargados</span>
        <div className="grow" />
        <CandyButton tone="lime" onClick={empezarNuevo} disabled={!canEdit}>
          + Acorde nuevo
        </CandyButton>
      </div>

      {error && <div className="notice bad">{error}</div>}
      {flash && <div className="notice good">{flash}</div>}

      {/* ---------- formulario ---------- */}
      {editing && (
        <div className="card stack-16">
          <div className="section-title">{isNew ? 'Acorde nuevo' : `Editando ${editing.id}`}</div>

          <div className="chord-card">
            <div className="diagram">
              <ChordDiagram frets={editing.frets} fingers={editing.fingers} onFretChange={cambiarTraste} />
              <p className="muted" style={{ textAlign: 'center', margin: 0, fontSize: 12 }}>
                Hacé clic en el mástil
              </p>
            </div>

            <div className="grow stack-16">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
                <label className="field">
                  <span>Acorde</span>
                  <input
                    className="f"
                    placeholder="D, Em, G7, F#m7"
                    value={editing.id}
                    disabled={!isNew}
                    onChange={(e) => cambiarId(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Nombre en castellano</span>
                  <input className="f" value={editing.name_es} onChange={(e) => patch({ name_es: e.target.value })} />
                </label>
                <label className="field">
                  <span>Orden en la lista</span>
                  <input
                    className="f tnum"
                    type="number"
                    value={editing.sort_order}
                    onChange={(e) => patch({ sort_order: Number(e.target.value) })}
                  />
                </label>
              </div>

              <div className="row">
                <span className="muted">Trastes:</span>
                {['G', 'C', 'E', 'A'].map((s, i) => (
                  <label key={s} className="row" style={{ gap: 5 }}>
                    <b>{s}</b>
                    <input
                      className="f tnum"
                      style={{ width: 58 }}
                      type="number"
                      min={0}
                      max={12}
                      value={editing.frets[i]}
                      onChange={(e) => cambiarTraste(i, Number(e.target.value))}
                    />
                  </label>
                ))}
              </div>

              {parsed && (
                <div className="notice">
                  <b>{editing.id}</b> se detecta buscando{' '}
                  {parsed.pitchClasses.map((pc, i) => (
                    <span key={pc}>
                      {i > 0 && ' · '}
                      <b>{pcName(pc)}</b>
                    </span>
                  ))}
                  . Eso lo deduce el editor del nombre del acorde y lo verifica contra la digitación.
                </div>
              )}
            </div>
          </div>

          <Issues issues={issues} />

          {/* Si los pesos guardados no son los que saldrían del nombre, alguien los
              midió a mano. Hay que decirlo, porque no se ven en ningún otro lado. */}
          {!isNew && parsed && calibradoAMano(editing.weights, parsed.weights) && (
            <div className="notice good">
              🎚️ Este acorde tiene la detección <b>calibrada a mano</b> con grabaciones reales
              ({editing.weights.map((w, i) => `${pcName(editing.pitch_classes[i] ?? 0)} ${w}`).join(' · ')}).
              Guardar <b>no</b> la toca: se respeta tal cual. Para cambiarla hay que volver a medir
              contra grabaciones, no deducirla del nombre del acorde.
            </div>
          )}

          <div className="notice warn">
            ⚠️ La detección de un acorde nuevo <b>no está probada</b>. El motor de audio está calibrado con
            grabaciones reales para C, Am, F y G. Antes de armar un nivel con este acorde, entrá a la app,
            afiná, y comprobá en la pantalla de acordes que lo reconoce.
          </div>

          <div className="row">
            <CandyButton tone="lime" onClick={() => void guardar()} disabled={!canEdit || busy || blocked}>
              Guardar acorde
            </CandyButton>
            <CandyButton tone="ghost" onClick={() => setEditing(null)}>
              Cancelar
            </CandyButton>
          </div>
        </div>
      )}

      {/* ---------- listado ---------- */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
        {chords.map((c) => {
          const col = chordColor(c.id);
          const usos = chordUsage(songs, c.id);
          return (
            <div key={c.id} className="card chord-card">
              <div className="diagram">
                <ChordDiagram frets={c.frets} fingers={c.fingers} size={104} />
              </div>
              <div className="grow">
                <div
                  className="chip"
                  style={{ background: col.bg, boxShadow: `0 4px 0 ${col.shadow}`, cursor: 'default' }}
                >
                  {c.id}
                  <small>{c.name_es}</small>
                </div>
                <p className="muted" style={{ margin: '8px 0 0' }}>
                  {c.pitch_classes.map(pcName).join(' · ')}
                  <br />
                  {usos.length ? `en ${usos.length} ${usos.length === 1 ? 'nivel' : 'niveles'}` : 'sin usar'}
                </p>
                <div className="row" style={{ marginTop: 8 }}>
                  <CandyButton
                    small
                    tone="sky"
                    disabled={!canEdit}
                    onClick={() => {
                      setEditing({ ...c });
                      setIsNew(false);
                      setError(null);
                      setFlash(null);
                    }}
                  >
                    Editar
                  </CandyButton>
                  <CandyButton small tone="melon" disabled={!canEdit || busy} onClick={() => void borrar(c)}>
                    Borrar
                  </CandyButton>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
