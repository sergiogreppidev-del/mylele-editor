import { createClient } from '@supabase/supabase-js';

// Solo la clave publicable (anon). Sin login no puede escribir nada: las políticas
// RLS de INSERT/UPDATE/DELETE exigen que el usuario esté en la tabla `admins`.
// La clave service_role NUNCA entra acá.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  throw new Error(
    'Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copiá .env.example como .env y completalos.',
  );
}

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});

/** ¿El usuario logueado está habilitado para editar contenido? */
export async function checkIsAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_admin');
  if (error) return false;
  return data === true;
}

/**
 * Le pide el texto a Gemini a través de una función de Supabase.
 * La clave de Gemini vive allá, no acá: este sitio es público y una clave en el
 * navegador se la lleva cualquiera que abra las herramientas de desarrollo.
 */
export async function generarConGemini(prompt: string): Promise<{ texto: string; cortado: boolean }> {
  const { data, error } = await supabase.functions.invoke('generar-nivel', { body: { prompt } });
  if (error) {
    // El cuerpo del error trae el motivo real; sin esto solo se ve "non-2xx".
    let detalle = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx) detalle = (await ctx.json())?.error ?? detalle;
    } catch {
      /* nos quedamos con el mensaje genérico */
    }
    throw new Error(detalle);
  }
  if (data?.error) throw new Error(data.error);
  return { texto: String(data?.texto ?? ''), cortado: !!data?.cortado };
}

/** Mensaje en castellano para los errores que más van a aparecer. */
export function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/row-level security/i.test(raw)) {
    return 'La base rechazó el cambio: tu usuario no tiene permisos de edición.';
  }
  if (/duplicate key.*slug/i.test(raw)) return 'Ya existe un nivel con ese identificador (slug).';
  if (/charts_one_published_per_mode/i.test(raw)) {
    return 'Ya hay otro chart publicado para esta canción y modo.';
  }
  if (/duplicate key/i.test(raw)) return 'Ya existe un registro igual.';
  if (/Invalid login credentials/i.test(raw)) return 'Mail o contraseña incorrectos.';
  if (/Failed to fetch/i.test(raw)) return 'Sin conexión con Supabase.';
  return raw;
}
