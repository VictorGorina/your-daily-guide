import { normalizeForMatch } from "@/lib/content-guard";

/**
 * Corte determinista de lo que está claramente fuera del alcance del coach,
 * ANTES de gastar una llamada al modelo.
 *
 * Es la segunda mitad de una pareja: la regla de alcance de `coachSystemPrompt`
 * es la que decide de verdad qué es y qué no es tema del coach (la heredan
 * chat, guía, plan, briefing y repaso nocturno), y esto de aquí solo adelanta
 * el caso más común y más caro de dejar pasar — pedirle que se salte sus
 * instrucciones o que escriba código. Cortarlo aquí ahorra la llamada entera:
 * ni cuota ni dinero.
 *
 * Por eso la lista es corta y pide DOS señales casi siempre (un verbo de
 * petición y un sustantivo técnico) en vez de una palabra suelta. El riesgo
 * aquí son los falsos positivos, no los falsos negativos: "¿cuál es mi código
 * de invitación?" es una pregunta legítima del hogar y no puede caerse, y lo
 * que se escape lo para igualmente el prompt.
 */

export type OffTopicReason = "override" | "code";

/** Intentos de anular las instrucciones o de convertir al coach en otro asistente. */
const OVERRIDE_PATTERNS: RegExp[] = [
  /\b(ignora|ignorate|olvida|olvidate|salta|saltate|desactiva|anula)\b[^.?!]{0,40}\b(instruccion\w*|reglas|normas|limites|restriccion\w*|prompt)\b/,
  /\b(system prompt|prompt del sistema|prompt de sistema|tus instrucciones exactas)\b/,
  /\b(a partir de ahora|de ahora en adelante|desde ahora|a partir de este momento)\b[^.?!]{0,30}\b(eres|seras|actua|actuas|comportate|te comportas)\b/,
  /\b(modo (desarrollador|dios|libre|sin filtros)|developer mode|jailbreak|sin censura)\b/,
  /\b(actua|comportate|hazte pasar|finge)\b[^.?!]{0,25}\bcomo\b[^.?!]{0,30}\b(chatgpt|gpt|claude|gemini|un asistente general|un programador|un abogado|un medico)\b/,
];

/** Peticiones de programar o de tocar cómo está hecha la app. */
const CODE_PATTERNS: RegExp[] = [
  /\b(escribe|escribeme|dame|generame|genera|hazme|programa|depura|debuggea|refactoriza)\b[^.?!]{0,30}\b(codigo|script|funcion|clase|consulta sql|query|regex|expresion regular)\b/,
  /\b(en|con)\s+(python|javascript|typescript|java|kotlin|swift|php|rust|golang)\b/,
  /\b(python|javascript|typescript|react|sql|html|css|bash)\b[^.?!]{0,25}\b(codigo|funcion|script|error|bug)\b/,
  /\b(codigo|funcion|script|error|bug|fallo)\b[^.?!]{0,25}\b(python|javascript|typescript|react|sql|html|css|bash)\b/,
  /\b(modifica|cambia|edita|reescribe|hackea|saltate)\b[^.?!]{0,25}\b(el codigo|tu codigo|el prompt|tu prompt|la base de datos|el backend|el servidor)\b/,
  /```/,
];

/**
 * Motivo por el que este mensaje no es para el coach, o `null` si puede pasar.
 * El motivo no se le enseña a la persona (el mensaje es siempre el mismo), pero
 * sirve para el log y para los tests.
 */
export function offTopicReason(text: string): OffTopicReason | null {
  const value = normalizeForMatch(text);
  if (!value.trim()) return null;
  if (OVERRIDE_PATTERNS.some((re) => re.test(value))) return "override";
  if (CODE_PATTERNS.some((re) => re.test(value))) return "code";
  return null;
}

/**
 * Lo que se le contesta. Es el mismo mensaje pase lo que pase: explicar por qué
 * se ha cortado sería un manual de cómo esquivarlo. Sigue el idioma del perfil,
 * como el resto de lo que escribe el coach (`languageName` en
 * `ai-provider.server.ts`).
 */
export function offTopicMessage(locale: string | null | undefined): string {
  return (locale ?? "es").toLowerCase().startsWith("en")
    ? "I'm only here for food and nutrition, so I can't help with that one. Want to pick up where we left off with your meals?"
    : "Yo solo me dedico a la alimentación, así que con eso no te puedo ayudar. ¿Seguimos con tus comidas?";
}
