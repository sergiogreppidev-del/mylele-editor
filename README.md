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

Un nivel puede tener varios charts en la base, pero **solo uno publicado** por canción y modo.

- **Guardar borrador** → se guarda con `published = false`. Los alumnos **no** lo ven.
- **Publicar** → ese chart pasa a estar en vivo y el anterior queda como historial.
- **Descartar borrador** → vuelve a la versión que está publicada.

Un nivel sin ningún chart publicado directamente no aparece en el mapa de niveles de la app.

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

> El editor visual de notas llega en la fase 2. Por ahora los niveles en modo notas se pueden
> ver y editar en su ficha, pero no en la grilla.

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
