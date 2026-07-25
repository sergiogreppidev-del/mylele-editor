import { DIFICULTADES } from '../lib/chartFormat';
import type { Difficulty } from '../lib/chartFormat';
import { PERFILES } from '../lib/dificultad';
import type { Metricas } from '../lib/dificultad';

interface Props {
  metricas: Metricas;
  dificultad: Difficulty;
}

/** Un número con su tope, coloreado según si lo pasa. */
function Dato({
  valor, unidad, que, tope, invertido = false,
}: {
  valor: number | string;
  unidad?: string;
  que: string;
  /** Tope del sub-nivel, si lo hay. */
  tope?: number;
  /** true = el problema es quedarse corto, no pasarse. */
  invertido?: boolean;
}) {
  const n = typeof valor === 'number' ? valor : NaN;
  const pasado =
    tope !== undefined && Number.isFinite(n) && (invertido ? n < tope : n > tope);
  return (
    <div className={'metrica' + (pasado ? ' pasado' : '')}>
      <span className="v tnum">
        {valor}
        {unidad && <small>{unidad}</small>}
      </span>
      <span className="q">{que}</span>
      {tope !== undefined && (
        <span className="t tnum">
          {invertido ? 'mínimo' : 'tope'} {tope}
        </span>
      )}
    </div>
  );
}

/**
 * La dificultad, medida en vez de intuida.
 *
 * Existe porque los tres niveles de acordes que estaban publicados daban todos
 * lo mismo —4 acordes, ~18 cambios por minuto, ~3 dedos por cambio— y no había
 * forma de darse cuenta sin tocarlos. Acá se ve de un vistazo, y al lado el tope
 * del sub-nivel que se eligió.
 */
export function DificultadPanel({ metricas: m, dificultad }: Props) {
  const perfil = PERFILES[dificultad];
  const label = DIFICULTADES.find((d) => d.id === dificultad)?.label ?? dificultad;

  if (m.tipo === 'melody') {
    return (
      <div className="metricas">
        <Dato valor={m.notas} que="notas" />
        <Dato valor={m.posiciones} que="posiciones distintas" />
        <Dato valor={m.trasteMax} que="traste más alto" />
        <Dato valor={m.saltosDeCuerda} que="cambios de cuerda" />
        <Dato valor={m.notasPorMinuto} que="notas por minuto" />
        <p className="muted" style={{ margin: '4px 0 0', flexBasis: '100%' }}>
          En un nivel de notas el sub-nivel todavía no impone topes: la melodía <i>es</i> la canción
          y recortarla la vuelve irreconocible. Estos números están para comparar niveles entre sí.
        </p>
      </div>
    );
  }

  return (
    <div className="metricas">
      <Dato valor={m.distintos.length} que={`formas: ${m.distintos.join(' ')}`} tope={perfil.maxDistintos} />
      <Dato valor={m.cambiosPorMinuto} que="cambios por minuto" tope={perfil.maxCambiosPorMinuto} />
      <Dato valor={m.dedosPorCambio} que="dedos por cambio" tope={perfil.maxDedosPorCambio} />
      <Dato
        valor={m.comasesPorAcorde}
        que="compases por acorde"
        tope={perfil.minCompasesPorAcorde}
        invertido
      />
      <Dato valor={m.rasgueosPorMinuto} que="rasgueos por minuto (mano derecha)" />
      {m.peorSalto && (
        <div className="metrica">
          <span className="v">
            {m.peorSalto.de} → {m.peorSalto.a}
          </span>
          <span className="q">el salto más duro · {m.peorSalto.dedos} dedos</span>
        </div>
      )}
      <p className="muted" style={{ margin: '4px 0 0', flexBasis: '100%' }}>
        Los topes son los de <b>{label}</b>. Los <b>rasgueos</b> no entran: son la mano derecha, un
        eje aparte — rasguear más no le agrega trabajo a la mano que forma los acordes.
      </p>
    </div>
  );
}
