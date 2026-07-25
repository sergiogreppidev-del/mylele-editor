# MyLele Editor

App web para crear, probar y publicar los niveles de **MyLele** sin escribir SQL.
Proyecto separado de la app de alumnos, apuntando al **mismo Supabase**.

**En vivo:** https://mylele-editor-git-main-punto-gesell.vercel.app/
**Repo:** `sergiogreppidev-del/mylele-editor` (privado) → Vercel, automático en cada push.

> Herramienta interna. No es una app para alumnos.

---

## Cómo usarlo

### En tu compu
Doble clic en **`probar-en-mi-compu.bat`**. La primera vez instala todo solo (tarda un minuto);
después abre el editor en el navegador. Para cerrarlo, `Ctrl+C` en la ventana negra.

### Subir cambios
Doble clic en **`subir-a-github.bat`**. Vercel compila y publica solo.

---

## Cómo entrar

Login con mail y contraseña. El usuario tiene que estar en la tabla `admins` de Supabase;
si no, entra pero no puede guardar nada (lo bloquea la base, no la pantalla).

**Para dar de alta a alguien** (una sola vez, desde el dashboard de Supabase):

1. Authentication → Users → **Add user** con su mail y contraseña.
2. SQL Editor:
   ```sql
   insert into public.admins (user_id, email)
   select id, email from auth.users where email = 'elmail@ejemplo.com';
   ```

El registro público está desactivado a propósito: nadie se crea una cuenta solo.

---

## Borrador y publicado

**Nada de lo que edites llega al alumno hasta que apretás Publicar.** Eso vale para las dos
mitades de la pantalla:

| | Dónde se guarda el borrador |
|---|---|
| La **partitura** (grilla de acordes o notas, y el fondo) | Un chart nuevo con `published = false`. Solo uno queda publicado por canción y modo; los demás son historial. |
| La **ficha** (título, BPM, compás, acceso, audio) | La columna `draft` de `songs`. Las columnas de al lado siguen siendo lo que ve el alumno. |

- **Guardar borrador** → se guarda todo escondido. Los alumnos siguen con lo publicado.
- **Publicar** → pasa a estar en vivo: la partitura y la ficha juntas.
- **Descartar** → vuelve a lo publicado. Hay un botón para la partitura y otro para la ficha.

Mientras la ficha tenga cambios sin publicar, el editor te muestra **qué están viendo los
alumnos en ese momento**, para que no haya sorpresas.

Un nivel sin ningún chart publicado directamente no aparece en el mapa de niveles de la app.

---

## Importar canciones con ayuda de una IA

Un nivel tiene **dos capas**:

- **Fondo** — una melodía que suena sola. La toca la app, el alumno no.
- **Juego** — los acordes o notas que el alumno tiene que tocar encima.

Las dos se pueden importar con el botón **✨ Importar con IA**. El ciclo es:

1. **Copiar instrucciones** → arma el pedido completo. Lo pegás en Claude o ChatGPT.
2. **Pegar** lo que te devuelva.
3. **Escuchar** antes de aceptar. La IA se equivoca con algunas melodías: este paso es el control
   de calidad, no un lujo.

> **No hace falta que sepas el compás ni el tempo de la canción.** Por defecto se los pedimos a
> la IA, que sí los sabe: te devuelve dos renglones (`BPM:` y `COMPAS:`) antes de la música, y el
> editor te ofrece aplicarlos al nivel con un clic. Solo si estás armando un ejercicio propio
> conviene tildar *"obligarla a usar…"* e imponerle vos la medida.

### La notación

Puede empezar con la medida que propone quien la escribió (opcional):

```
BPM: 120
COMPAS: 3/4
```

Y después, una sola línea de música. Cada elemento es `NOMBRE/DURACION`, y la duración va en **tiempos**:

```
notas     | G4/.5 G4/.5 | A4/1 G4/1 C5/1 | B4/2 r/1 |
acordes   | C/4 | Am/4 | F/2 G/2:u | C/4 |
```

- `1` = negra · `.5` = corchea · `2` = blanca · `1.5` = negra con puntillo.
- `r/1` es un silencio: corre el tiempo, no genera evento.
- `|` separa compases. Si un compás no suma los tiempos que debería, el editor te dice
  **cuál** y por cuánto se pasó.
- `:d` / `:u` es la dirección del rasgueo (solo en acordes). Por defecto, abajo.
- Las notas llevan octava: `G4`, `A#3`, `Bb5`.

**Por qué este formato y no el JSON directo:** quien escribe solo dice qué suena y cuánto dura.
El beat de inicio lo calcula el editor sumando duraciones, así que nunca se desfasa — que es
justo donde una IA se equivoca cuando se le pide el JSON con los tiempos ya resueltos.

El editor también acepta el **JSON** que él mismo genera, y con **"Traer lo que ya hay"**
convierte el nivel actual a notación para pegárselo a la IA y pedirle cambios.

### Del pentagrama al ukelele

Si importás notas como nivel jugable, el editor traduce cada altura a **cuerda + traste**,
eligiendo la posición más cómoda. El ukelele llega de **C4 a A5**: si la melodía es más grave,
la sube de octava sola y te avisa. Si abarca más de lo que entra, te lo dice en vez de guardar
algo intocable.

En el **fondo** no hay esa restricción: como lo sintetiza la app, puede ir en cualquier octava.

---

## Reglas del formato (no se negocian)

Los tiempos van **siempre en beats**, nunca en segundos.
`t` = beat de inicio (0 = primer tiempo) · `dur` = duración en beats.

**Modo acordes:**
```json
{"t": 0, "chord": "C", "dur": 4, "dir": "d"}
```
`dir`: `"d"` abajo ↓ (por defecto) | `"u"` arriba ↑. La dirección **no se detecta por audio**,
es guía visual para el alumno. El acorde tiene que existir en la tabla `chords` o la app
no lo dibuja ni lo detecta.

**Modo notas (tablatura):**
```json
{"t": 0, "string": "C", "fret": 0, "dur": 1}
```
Se escribe **cuerda + traste**, nunca el nombre de la nota: la app calcula la nota sola y
dibuja el número de traste. Cuerdas de arriba hacia abajo: **G · C · E · A**.

En el editor esto se dibuja en **cuatro carriles**, uno por cuerda (G · C · E · A de arriba
hacia abajo, igual que en la pista del juego). Elegís un traste de la paleta y hacés clic en la
cuerda; con una nota seleccionada, los números del teclado le cambian el traste y las flechas ↑↓
la mueven de cuerda.

Si importás una melodía por altura (`G4`, `C5`…), el editor la traduce solo a cuerda y traste,
eligiendo la posición más cómoda.

---

## Acompañamiento grabado

En vez del acompañamiento sintetizado, un nivel puede tener un **audio grabado**. Se sube desde
la ficha del nivel y reemplaza a todo lo sintetizado.

Dos condiciones para que calce:

1. La grabación está al **BPM del nivel**.
2. Arranca en el **tiempo 1**, sin cuenta de entrada grabada (la cuenta la pone la app).

Como ninguna grabación arranca exacta, está el control de **calce**: si la música entra tarde
bajás el número, si entra temprano lo subís. Escuchá con el metrónomo prendido — el primer
golpe de la grabación tiene que caer junto al primer clic después de la cuenta de entrada.

La ficha del nivel (título, BPM, audio…) también tiene borrador: al guardar, los alumnos siguen
viendo lo publicado, y el editor te avisa qué están viendo mientras tanto.

---

## Acordes

La pestaña **🎸 Acordes** es el ABM del catálogo: alta, edición y borrado con el diagrama de
digitación, para sumar D, Em, G7 y compañía sin escribir SQL.

Las **notas del acorde** (lo que el motor de audio busca para detectarlo) se deducen del nombre
—`G7` → G · B · D · F— y se verifican contra los trastes que dibujaste. Si la digitación no da
esas notas, el editor te dice cuál falta y no deja guardar.

> ⚠️ **La detección de un acorde nuevo no está probada.** El motor de audio está calibrado con
> grabaciones reales solo para C, Am, F y G. Antes de armar un nivel con un acorde nuevo, entrá
> a la app de alumnos, afiná, y comprobá en la pantalla de acordes que lo reconoce.

Un acorde que esté en uso no se puede borrar: el editor te dice en qué niveles aparece.

---

## Seguridad

- En el navegador va **solo la clave publicable** (`anon`) + el login del usuario.
- La `service_role` **nunca** entra al repo, al `.env` ni a Vercel.
- Las políticas RLS de escritura exigen que el usuario esté en `admins`. Sin login,
  la base solo deja leer — que es exactamente lo que necesita la app de alumnos.

---

## Estructura

| Archivo | Para qué |
|---|---|
| `src/lib/chartFormat.ts` | Tipos y **validación** del chart. Fuente de verdad del formato. |
| `src/lib/db.ts` | Todas las consultas a Supabase. |
| `src/lib/previewAudio.ts` | Metrónomo y acompañamiento — portado de `game.js` de la app de alumnos. |
| `src/lib/supabase.ts` | Cliente y mensajes de error en castellano. |
| `src/components/BeatGrid.tsx` | La grilla de compases y tiempos. |
| `src/screens/ChartEditor.tsx` | La pantalla de edición completa. |
| `src/styles/mylele.css` | Sistema de diseño copiado de la app de alumnos. |
