# CLAUDE.md — MyLele Editor

Guía para trabajar en este repo con Claude Code. El usuario (fundador) **no es técnico**:
explicá en lenguaje claro y no asumas que va a leer el código.

> La guía del producto entero está en el repo hermano: `../MuLulu/CLAUDE.md`.
> Ahí está la app de alumnos, el esquema de Supabase y las decisiones de audio.
> **Los dos repos comparten la misma base**, así que un cambio de esquema toca los dos.

## Qué es

App web para crear, probar y publicar los niveles de MyLele sin escribir SQL.
Repo y proyecto de Vercel propios, mismo Supabase que la app de alumnos.

**React + Vite + TypeScript.** `sergiogreppidev-del/mylele-editor` → Vercel en cada push.

## Reglas que no se negocian

- **La `service_role` key NUNCA en el navegador.** Acá solo va la `anon` key + el JWT
  de sesión. Escribir requiere estar en la tabla `admins`, y lo verifica RLS en el servidor.
- **La clave de la IA tampoco.** Vive como secreto de la función `generar-nivel` en Supabase.
  El editor le habla a esa función, nunca al proveedor.
- **Antes de commitear:** `npm run probar` y `npm run build`. Los dos tienen que pasar.

## Cómo está organizado

La lógica sale de las pantallas a módulos propios **para poder probarla**. No es prolijidad:
todos los errores graves que tuvo este editor vivieron en la lógica sin cubrir.

| Módulo | Qué resuelve |
|---|---|
| `lib/chartFormat.ts` | Tipos y validación del formato. Fuente de verdad. |
| `lib/notation.ts` | El texto que escribe la IA → eventos con sus tiempos calculados |
| `lib/chartPick.ts` | **Qué chart se edita.** Acá vivieron los dos peores bugs |
| `lib/dificultad.ts` | Mide qué tan difícil es un nivel, con las digitaciones reales |
| `lib/calidad.ts` | ¿La armonía es de esta canción? ¿El fondo es música o metrónomo? |
| `lib/estructura.ts` | Repetir y duplicar compases, en todas las capas |
| `lib/aiPrompt.ts` | Arma el pedido para la IA |
| `lib/chordTheory.ts` | Nombre de acorde → notas, y verificación contra la digitación |
| `lib/previewAudio.ts` | Reproducción de prueba (portada de `game.js` de la app de alumnos) |
| `lib/db.ts` | Todas las consultas a Supabase. Envoltorio fino sobre `chartPick` |

Las pantallas (`screens/`) arman la interfaz y no deciden nada que se pueda probar aparte.
**`ChartEditor.tsx` tiene ~1.400 renglones y conviene partirlo** en sus tres pasos.

## Las trampas que ya nos mordieron

Están todas cubiertas por pruebas. Si tocás algo de esto, corré `npm run probar`.

- **"El primer chart de la lista".** El orden que devuelve PostgREST **no está garantizado**:
  se comprobó que devuelve el acompañamiento antes que los acordes. Nunca `charts[0]`;
  siempre `chartPick`, que elige primero el publicado y después la versión más alta.
- **Preguntar por un sub-nivel fijo.** Una canción vive en **UN** sub-nivel. Preguntar
  siempre por `'facil'` hacía que una canción publicada apareciera como borrador vacío.
- **Los pesos del acorde G.** `{1.0, 1.6, 0.5}` en la base, medidos contra grabaciones
  reales (la detección subió de 10/39 a 38/39). `parseChordName` genera otros muy distintos.
  Por eso **al editar un acorde que ya existe los pesos NO se recalculan**.
- **El miniejemplo del pedido no puede ser la canción que se pide.** Era el arranque de
  "Feliz cumpleaños": cuando se pedía esa canción, el modelo copiaba el ejemplo y frenaba
  a los tres compases. Pasó dos veces, en dos pedidos distintos.
- **La anacrusa.** Los compases empiezan en `pickup_beats + k*bpb`, no cada N desde cero.
  Sin esto el acento cae en la sílaba equivocada y la canción no se reconoce.
- **Un elemento de la capa de acordes es UN RASGUEO, no "un acorde".** Su `dur` es cuánto
  lo dejás sonar. `C/2` es un golpe que suena dos tiempos, **no** dos golpes de uno.
  El pedido a la IA decía "en 4/4 son todos X/4" y de ahí salía un golpe por compás de
  punta a punta: el final de Estrellita pide un Do sostenido y el juego mostraba dos Do
  seguidos, así que había que cortar el acorde justo donde la canción respira.
  La regla es **el rasgueo sigue el ritmo de la melodía**, y el eje de dificultad es cada
  cuánto CAMBIA el acorde — no cuántas veces se rasguea. Por eso `C/2 C/2` pasó de ser un
  error a ser correcto: son dos golpes del mismo acorde. Lo cubre `detectarRasgueoMecanico`
  en `calidad.ts`, que avisa cuando **todos** los golpes duran lo mismo.
- **La ligadura `~/1`.** Alarga lo anterior en vez de volver a tocarlo, y es la única forma
  de que algo cruce la barra de compás: `F/3 | ~/3` es un evento de seis tiempos.
  Se eligió `~` y no `-` porque el guion ya es uno de los nombres del silencio.
  Sin ella, `toNotation` escribía el evento largo entero y corría la barra — un texto que
  **ya no se podía volver a leer**, o sea que la ida y la vuelta no cerraban justo en las
  canciones con acordes sostenidos.
- **Operaciones de estructura.** Repetir o duplicar tiene que mover **todas** las capas,
  y el bloque se mide sobre la más larga.

## El modelo de dificultad

Dos ejes que se confundían:

- **Etapa** (Fácil · Intermedia · Difícil) — cuánto vocabulario se usa. Hoy todo está en
  Fácil. **No existe en el código**: cuando se definan las otras dos, van a necesitar
  su propia columna.
- **Sub-nivel** (columna `difficulty`, valores `'facil'`/`'dificil'`, etiquetados
  **"Fácil 1"** y **"Fácil 2"**) — con el mismo vocabulario, qué se le pide a la **mano
  izquierda**. Es la receta con la que se le pidió la canción a la IA, no una variante
  que el juego elija después.

**"Acordes por compás" NO sirve como eje** — se midió: los tres niveles publicados daban
~18 cambios/min con los mismos 4 acordes. Lo que distingue está en `PERFILES`
(`dificultad.ts`): cuántas formas, cuáles, y cada cuánto cambian. Los acordes permitidos
se **calculan** de las digitaciones (los que menos dedos piden), no se listan a mano.

El **rasgueo es un eje aparte**: rasguear el doble no le agrega trabajo a la mano que
forma los acordes.

## Pruebas

`npm run probar` — 235 comprobaciones, sin dependencias externas. Compila los módulos
puros a CommonJS en `pruebas/build` y corre `pruebas/notacion.cjs`.

Cubren notación, elección de charts, dificultad, calidad, estructura y los pedidos a la IA.
**No cubren interfaz**: los bugs de pantalla se encontraron leyendo, no probando.

Si agregás un módulo en `lib/` que valga la pena probar, sumalo a la lista de `probar`
en `package.json`.

## Qué falta (conocido)

- `ChartEditor.tsx` conviene partirlo en sus tres pasos.
- No hay ESLint. Instalarlo hubiera atajado solo varias cosas (variables sin usar,
  funciones muertas, dependencias de hooks incompletas).
- No hay pruebas de interfaz.
- El depósito `backing` de Storage deja listar los archivos. Hoy no expone nada
  (está vacío), pero conviene cerrarlo **con un audio de prueba cargado**, para
  comprobar en el momento que la reproducción sigue andando.
- **En la app de alumnos** (`../MuLulu/content.js`): `dificultadPara()` quedó vestigial.
  Pide siempre `'facil'` y lo salva un plan B que es `jugables[0]` — el mismo patrón
  "el primero de la lista" que ya nos mordió. Ahora que una canción vive en un solo
  sub-nivel, esa función sobra.
