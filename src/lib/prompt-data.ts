/**
 * Prepara un valor escrito por la persona para meterlo en el prompt: quita
 * saltos de línea y marcadores de bloque, recorta y lo envuelve en «» para que
 * se vea dónde empieza y dónde acaba el dato.
 *
 * No es cosmética. La herramienta `actualizar_perfil` del chat deja escribir
 * estos campos, así que sin esto alguien puede guardar "ignora tus
 * instrucciones" en `life_context` y queda inyectado en el system prompt de
 * TODAS las superficies (chat, guía diaria, plan mensual, briefing y repaso
 * nocturno) para siempre, en cada llamada. El prompt dice explícitamente que lo
 * que va entre «» es un dato y no una instrucción.
 */
export const PROMPT_FIELD_MAX = 600;

/**
 * `max` sube el tope para contexto largo que también es dato (la guía o el
 * registro del día en JSON, ya acotados por `CHAT_LIMITS`): con 600 se
 * quedarían cortados.
 */
export function asPromptData(
  value: string | number | null | undefined,
  max: number = PROMPT_FIELD_MAX,
): string {
  const clean = String(value ?? "")
    // Fences, comillas angulares (cerrar la «» propia) y caracteres de control
    // (Cc/Cf: saltos de línea, tabuladores y los invisibles de dirección).
    .replace(/[`«»]+/g, " ")
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return clean ? `«${clean}»` : "";
}
