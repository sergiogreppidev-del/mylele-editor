import { useMemo, useState } from 'react';
import { CandyButton } from './CandyButton';
import { Issues } from './Issues';
import { buildAiPrompt, TARGET_LABEL } from '../lib/aiPrompt';
import type { ImportTarget } from '../lib/aiPrompt';
import { parseNotation, toNotation } from '../lib/notation';
import type { SuggestedSetup } from '../lib/notation';
import { parseBacking, parseEvents, tidy } from '../lib/chartFormat';
import type { BackingEvent, ChordEvent, Issue, MelodyEvent } from '../lib/chartFormat';

interface Props {
  target: ImportTarget;
  title: string;
  bpm: number;
  timeSig: string;
  beatsPerBar: number;
  bars: number;
  knownChords: string[];
  /** Eventos actuales, para ofrecer "agregar al final" y exportar. */
  currentChords: ChordEvent[];
  currentMelody: MelodyEvent[];
  currentBacking: BackingEvent[];
  onPreview: (playable: (ChordEvent | MelodyEvent)[], backing: BackingEvent[]) => void;
  onApply: (result: {
    chords?: ChordEvent[];
    melody?: MelodyEvent[];
    backing?: BackingEvent[];
    /** Compás y tempo que propuso la IA, si el autor eligió aplicarlos. */
    setup?: { bpm?: number; timeSig?: string };
  }) => void;
  onClose: () => void;
}

type Mode = 'replace' | 'append';

/**
 * Pegar → ver → escuchar → aceptar. No toca nada hasta que el autor aprueba,
 * que es la red de seguridad contra lo que la IA se manda mal.
 */
export function ImportDialog(props: Props) {
  const { target, beatsPerBar, knownChords, bars } = props;
  const [text, setText] = useState('');
  const [pedido, setPedido] = useState('');
  const [mode, setMode] = useState<Mode>('replace');
  const [copied, setCopied] = useState(false);
  /** false = la IA decide compás y tempo (lo normal). true = los impone el autor. */
  const [imponerMedida, setImponerMedida] = useState(false);
  const [aplicarSetup, setAplicarSetup] = useState(true);

  /** Generar el nivel entero reemplaza las tres capas: agregar al final no aplica. */
  const esNivelCompleto = target === 'nivel';

  /** La capa que se está importando, tal como está ahora. */
  const current: { t: number; dur: number }[] = esNivelCompleto
    ? []
    : target === 'backing'
      ? props.currentBacking
      : target === 'melody'
        ? props.currentMelody
        : props.currentChords;

  const currentEnd = useMemo(() => {
    const end = current.reduce((m, e) => Math.max(m, e.t + e.dur), 0);
    // Al agregar al final se arranca en el compás siguiente, no pegado a la última nota.
    return Math.ceil(end / beatsPerBar) * beatsPerBar;
  }, [current, beatsPerBar]);

  const parsed = useMemo(() => {
    const trimmed = text.trim();
    if (!trimmed) return null;

    // Si arranca con "[" es el JSON del propio editor, no la notación de texto.
    if (trimmed.startsWith('[')) {
      try {
        const raw = JSON.parse(trimmed);
        const issues: Issue[] = [];
        if (target === 'backing') {
          const backing = parseBacking(raw);
          if (backing.length === 0) issues.push({ level: 'error', message: 'El JSON no tiene notas de fondo con "pitch".' });
          return { kind: 'json' as const, chords: [], melody: [], backing, issues, totalBeats: end(backing), suggested: {} as SuggestedSetup, bpb: beatsPerBar };
        }
        const evs = parseEvents(raw);
        if (evs.length === 0) issues.push({ level: 'error', message: 'El JSON no tiene eventos reconocibles.' });
        const chords = evs.filter((e): e is ChordEvent => 'chord' in e);
        const melody = evs.filter((e): e is MelodyEvent => 'string' in e);
        return { kind: 'json' as const, chords, melody, backing: [], issues, totalBeats: end(evs), suggested: {} as SuggestedSetup, bpb: beatsPerBar };
      } catch {
        return {
          kind: 'json' as const, chords: [], melody: [], backing: [], totalBeats: 0, suggested: {} as SuggestedSetup, bpb: beatsPerBar,
          issues: [{ level: 'error' as const, message: 'Eso parece JSON pero está mal escrito (falta una coma o un corchete).' }],
        };
      }
    }

    // En modo nivel completo, lo que venga sin encabezado de sección se toma como acordes.
    const r = parseNotation(trimmed, {
      target: esNivelCompleto ? 'chords' : target,
      beatsPerBar,
      knownChords,
      autoTranspose: true,
    });
    return {
      kind: 'notation' as const,
      chords: r.chordEvents,
      melody: r.melodyEvents,
      backing: r.backingEvents,
      issues: r.issues,
      totalBeats: r.totalBeats,
      suggested: r.suggested,
      bpb: r.beatsPerBarUsed,
    };
  }, [text, target, esNivelCompleto, beatsPerBar, knownChords]);

  const errors = parsed?.issues.filter((i) => i.level === 'error').length ?? 0;
  const count = parsed ? parsed.chords.length + parsed.melody.length + parsed.backing.length : 0;
  const canApply = !!parsed && errors === 0 && count > 0;

  const offset = mode === 'append' ? currentEnd : 0;
  const shifted = useMemo(() => {
    if (!parsed) return { chords: [], melody: [], backing: [] };
    const bump = <T extends { t: number }>(list: T[]): T[] => list.map((e) => ({ ...e, t: tidy(e.t + offset) }));
    return { chords: bump(parsed.chords), melody: bump(parsed.melody), backing: bump(parsed.backing) };
  }, [parsed, offset]);

  /** La melodía que ya tiene el nivel: primero la jugable, si no el fondo. */
  const melodiaDelNivel = useMemo(() => {
    if (target !== 'chords') return undefined;
    const fuente = props.currentMelody.length ? props.currentMelody : props.currentBacking;
    if (!fuente.length) return undefined;
    return toNotation(fuente as never, beatsPerBar);
  }, [target, props.currentMelody, props.currentBacking, beatsPerBar]);

  async function copyPrompt() {
    const prompt = buildAiPrompt({
      target, title: props.title, bpm: props.bpm, timeSig: props.timeSig,
      beatsPerBar, bars, knownChords, pedido, imponerMedida, melodiaDelNivel,
    });
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Si el navegador bloquea el portapapeles, al menos lo dejamos a la vista.
      setText(prompt);
    }
  }

  function exportCurrent() {
    setText(toNotation(current as never, beatsPerBar));
  }

  return (
    <div className="overlay" onClick={props.onClose}>
      <div className="card dialog" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2 style={{ fontSize: 20 }}>Importar {TARGET_LABEL[target]}</h2>
          <div className="grow" />
          <CandyButton small tone="ghost" onClick={props.onClose}>
            ✕
          </CandyButton>
        </div>

        {/* --- paso 1: pedirle a la IA --- */}
        <div className="step">
          <div className="section-title">1 · Pedile la canción a una IA</div>
          <div className="row">
            <input
              className="f grow"
              placeholder="Qué querés. Ej: Feliz cumpleaños en Do"
              value={pedido}
              onChange={(e) => setPedido(e.target.value)}
            />
            <CandyButton small tone="sun" onClick={() => void copyPrompt()}>
              {copied ? '✓ Copiado' : '📋 Copiar instrucciones'}
            </CandyButton>
          </div>
          {!esNivelCompleto && (
            <label className="row" style={{ gap: 7, marginTop: 8 }}>
              <input
                className="f"
                type="checkbox"
                checked={imponerMedida}
                onChange={(e) => setImponerMedida(e.target.checked)}
              />
              <span>
                Obligarla a usar <b>{props.timeSig} a {props.bpm} BPM</b> en <b>{bars} compases</b>
              </span>
            </label>
          )}
          {melodiaDelNivel && (
            <div className="notice good" style={{ marginTop: 8 }}>
              🎵 Este nivel ya tiene la melodía cargada, así que va incluida en el pedido: la IA va a
              armonizar <b>esa</b> melodía, no la que recuerde de la canción. Sale bastante mejor.
            </div>
          )}
          <p className="muted" style={{ margin: '6px 0 0' }}>
            {esNivelCompleto ? (
              <>
                Un solo pedido y la IA escribe <b>el nivel entero</b>: acompañamiento, melodía y
                acordes, ya alineados entre sí. Los acordes suelen salir mejor así, porque los arma
                con la melodía que acaba de escribir delante.
              </>
            ) : imponerMedida ? (
              <>
                La IA va a meter la música dentro de esa medida. Sirve para ejercicios propios;
                para una canción conocida suele salir cortada o forzada.
              </>
            ) : (
              <>
                <b>La IA decide el compás y el tempo</b> que le corresponden a la canción y te los
                dice — no hace falta que los sepas de antemano. Después el editor te ofrece
                aplicarlos al nivel con un clic.
              </>
            )}
          </p>
        </div>

        {/* --- paso 2: pegar --- */}
        <div className="step">
          <div className="row">
            <div className="section-title grow">2 · Pegá lo que te dio</div>
            <CandyButton small tone="ghost" onClick={exportCurrent}>
              Traer lo que ya hay
            </CandyButton>
          </div>
          <textarea
            className="f mono"
            placeholder={
              esNivelCompleto
                ? 'BPM: 100\nCOMPAS: 4/4\nFONDO: | [C3,E3,G3]/4 | ...\nMELODIA: | C4/1 C4/1 G4/1 G4/1 | ...\nACORDES: | C/4 | F/2 C/2 |'
                : target === 'chords'
                  ? '| C/4 | Am/4 | F/4 | G/4 |'
                  : '| G4/.5 G4/.5 A4/1 G4/1 | C5/1 B4/2 r/1 |'
            }
            rows={esNivelCompleto ? 7 : 4}
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <p className="muted" style={{ margin: '6px 0 0' }}>
            Acepta la notación de texto o el JSON que genera este mismo editor.
          </p>
        </div>

        {/* --- paso 3: revisar --- */}
        {parsed && (
          <div className="step">
            <div className="section-title">3 · Revisá antes de aceptar</div>
            {count > 0 && (
              <div className="notice good" style={{ marginBottom: 8 }}>
                {esNivelCompleto ? (
                  <>
                    <b>Nivel completo</b> · {tidy(parsed.totalBeats)} tiempos ·{' '}
                    {Math.round((parsed.totalBeats / parsed.bpb) * 10) / 10} compases
                    <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                      <li>Fondo: {parsed.backing.length} notas</li>
                      <li>Melodía: {parsed.melody.length} notas</li>
                      <li>Acordes: {parsed.chords.length}</li>
                    </ul>
                  </>
                ) : (
                  <>
                    {count} {target === 'chords' ? 'acordes' : 'notas'} · {tidy(parsed.totalBeats)} tiempos ·{' '}
                    {Math.round((parsed.totalBeats / parsed.bpb) * 10) / 10} compases
                  </>
                )}
              </div>
            )}

            {/* Que falte una capa no es un error, pero casi siempre es un descuido. */}
            {esNivelCompleto && count > 0 && (parsed.backing.length === 0 || parsed.melody.length === 0 || parsed.chords.length === 0) && (
              <div className="notice warn" style={{ marginBottom: 8 }}>
                Falta{' '}
                {[
                  parsed.backing.length === 0 && 'el fondo',
                  parsed.melody.length === 0 && 'la melodía',
                  parsed.chords.length === 0 && 'los acordes',
                ]
                  .filter(Boolean)
                  .join(' y ')}
                . Fijate que la respuesta tenga los tres renglones: <b>FONDO:</b>, <b>MELODIA:</b> y <b>ACORDES:</b>.
              </div>
            )}

            {/* Lo que la IA propuso para el nivel. Acá está la vuelta: el dato que
                el autor no tenía se lo trae la canción. */}
            {(parsed.suggested.bpm || parsed.suggested.timeSig) && (
              <div className="notice" style={{ marginBottom: 8 }}>
                <div className="row">
                  <span className="grow">
                    ✨ La IA dice que esta canción va en{' '}
                    {parsed.suggested.timeSig && <b>{parsed.suggested.timeSig}</b>}
                    {parsed.suggested.timeSig && parsed.suggested.bpm && ' a '}
                    {parsed.suggested.bpm && <b>{parsed.suggested.bpm} BPM</b>}
                    {' · '}
                    {Math.ceil(parsed.totalBeats / parsed.bpb)} compases.
                  </span>
                </div>
                <label className="row" style={{ gap: 7, marginTop: 6 }}>
                  <input
                    className="f"
                    type="checkbox"
                    checked={aplicarSetup}
                    onChange={(e) => setAplicarSetup(e.target.checked)}
                  />
                  <span>
                    Aplicar al nivel
                    {(props.timeSig !== parsed.suggested.timeSig || props.bpm !== parsed.suggested.bpm) && (
                      <span className="muted">
                        {' '}
                        (ahora está en {props.timeSig} a {props.bpm} BPM)
                      </span>
                    )}
                  </span>
                </label>
              </div>
            )}
            <Issues issues={parsed.issues} />
            {canApply && (
              <div className="row" style={{ marginTop: 8 }}>
                <CandyButton
                  small
                  tone="lime"
                  onClick={() => props.onPreview([...shifted.chords, ...shifted.melody], shifted.backing)}
                >
                  ▶ Escuchar
                </CandyButton>
                {esNivelCompleto ? (
                  <span className="muted">
                    {parsed.chords.length > 0 && parsed.melody.length > 0
                      ? 'El alumno va a tocar los acordes; la melodía pasa a sonar de fondo.'
                      : 'Reemplaza las tres capas del nivel.'}
                  </span>
                ) : (
                  <>
                    <label className="row" style={{ gap: 6 }}>
                      <input
                        className="f"
                        type="radio"
                        checked={mode === 'replace'}
                        onChange={() => setMode('replace')}
                      />
                      <span>Reemplazar todo</span>
                    </label>
                    <label className="row" style={{ gap: 6 }}>
                      <input
                        className="f"
                        type="radio"
                        checked={mode === 'append'}
                        onChange={() => setMode('append')}
                      />
                      <span>Agregar desde el compás {Math.floor(currentEnd / beatsPerBar) + 1}</span>
                    </label>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        <div className="row" style={{ marginTop: 4 }}>
          <CandyButton
            tone="lime"
            disabled={!canApply}
            onClick={() => {
              if (!parsed) return;
              const add = mode === 'append';
              const setup = aplicarSetup ? parsed.suggested : undefined;
              if (esNivelCompleto) {
                // Las tres capas de una: se reemplaza todo lo que traiga el pegado.
                props.onApply({
                  setup,
                  chords: shifted.chords,
                  melody: shifted.melody,
                  backing: shifted.backing,
                });
              } else {
                props.onApply(
                  target === 'backing'
                    ? { backing: add ? [...props.currentBacking, ...shifted.backing] : shifted.backing, setup }
                    : target === 'chords'
                      ? { chords: add ? [...props.currentChords, ...shifted.chords] : shifted.chords, setup }
                      : { melody: add ? [...props.currentMelody, ...shifted.melody] : shifted.melody, setup },
                );
              }
            }}
          >
            Aceptar
          </CandyButton>
          <CandyButton tone="ghost" onClick={props.onClose}>
            Cancelar
          </CandyButton>
          <div className="grow" />
          <span className="muted">Nada se guarda hasta que le des a Guardar borrador.</span>
        </div>
      </div>
    </div>
  );
}

function end(list: { t: number; dur: number }[]): number {
  return tidy(list.reduce((m, e) => Math.max(m, e.t + e.dur), 0));
}
