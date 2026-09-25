import { ValidationError } from "@/lib/validation-error";

/**
 * Guard de contenido para el texto libre que escribe la persona: un plato, un
 * picoteo, un ingrediente o un nombre tienen que ser eso y no una broma.
 *
 * Hace falta porque ese texto no es efímero: un plato se guarda en
 * `monthly_plans.plan`, se ve todo el mes en Hoy y en el calendario, se espeja
 * al resto del hogar (`syncSharedMeals`) y vuelve a entrar en los prompts del
 * modelo. Una vez dentro, nadie lo corrige.
 *
 * Es la primera de dos redes, no la única: esta corta lo evidente sin gastar
 * nada, y la segunda —el campo `comida` que devuelve `resolveDish`— coge lo que
 * una lista nunca cogerá (otros idiomas, eufemismos, "un plato de heces"). Por
 * eso la lista de aquí es CORTA y solo tiene términos inequívocos: un falso
 * positivo le impide a alguien apuntar lo que de verdad ha comido, que es mucho
 * peor que dejar pasar una broma que luego caza el modelo.
 *
 * Lógica pura y testeada (`content-guard.test.ts`). Copia espejo en
 * `mobile/lib/content-guard.ts`, igual que `snacks.ts` y `plan-shared.ts` — no
 * hay paquete compartido entre web y móvil.
 */

/**
 * Alimentos reales que caerían por un pelo. `penne` es el caso que rompe
 * cualquier implementación ingenua: al colapsar letras repetidas se convierte
 * en un término bloqueado. Los demás están aquí como documentación y como
 * regresión — hoy sobreviven solos porque la comparación es por token entero,
 * y esta lista impide que un cambio futuro se los lleve por delante.
 */
const FOOD_ALLOWLIST = new Set([
  "penne",
  "cacahuete",
  "cacahuate",
  "cacao",
  "tetilla",
  "culantro",
  // "rabo de toro" es un guiso clásico; "cagarria" es la colmenilla en media España.
  "rabo",
  "cagarria",
  // Los altramuces son "chochos" en Andalucía y Canarias.
  "chocho",
  "puttanesca",
  "putanesca",
  "cockle",
  "cocktail",
  "coctel",
]);

/**
 * Términos que nunca son comida en ningún contexto. Deliberadamente sin los
 * ambiguos: `rabo`, `chocho`, `polvo` (de hornear), `leche` y `huevos` son
 * alimentos de verdad y se quedan fuera a propósito — de su uso soez se encarga
 * la red semántica del modelo, que sí entiende el contexto.
 */
const BLOCKED_TERMS = new Set([
  // Escatología
  "caca",
  "cagada",
  "cagarro",
  "mierda",
  "excremento",
  "heces",
  "zurullo",
  "meada",
  "vomito",
  "shit",
  "crap",
  "poop",
  "turd",
  // Sexual
  "pene",
  "polla",
  "verga",
  "picha",
  "cipote",
  "coño",
  "cono",
  "teta",
  "culo",
  "semen",
  "esperma",
  "follar",
  "penis",
  "dick",
  "cock",
  "cum",
  // Insulto
  "puta",
  "puto",
  "gilipollas",
  "cabron",
  "hijoputa",
  "fuck",
  "bitch",
]);

/** Dígitos y símbolos que se usan para escribir una palabra esquivando un filtro. */
const LEET: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  $: "s",
};

/**
 * Baja el texto al terreno donde se compara: minúsculas, sin tildes y con el
 * leet deshecho. No colapsa letras repetidas — eso se hace solo al comparar con
 * la lista, porque `penne` tiene que llegar entero al allowlist.
 */
export const normalizeForMatch = (text: string): string =>
  String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[0-9@$]/g, (ch) => LEET[ch] ?? ch);

/** Palabras del texto. Partir por lo que no es letra es lo que da el límite de palabra. */
const tokensOf = (text: string): string[] =>
  normalizeForMatch(text)
    .split(/[^a-zñ]+/)
    .filter(Boolean);
/** `caaaacaaa` → `caca`. Solo para comparar, nunca para guardar. */
const collapseRepeats = (token: string): string => token.replace(/(.)\1+/g, "$1");

/**
 * Las formas con las que se compara un token: tal cual, sin plural (las dos
 * terminaciones castellanas, porque "penes" pierde una "s" y "heces" ya viene
 * en plural en la lista) y con las letras repetidas colapsadas. Se prueban
 * todas contra el allowlist ANTES que contra la lista negra: así `penne`
 * sobrevive aunque una de sus formas sea un término bloqueado.
 */
const candidateForms = (token: string): string[] => {
  const forms = new Set<string>([token]);
  if (token.length > 3 && token.endsWith("s")) forms.add(token.slice(0, -1));
  if (token.length > 4 && token.endsWith("es")) forms.add(token.slice(0, -2));
  for (const form of [...forms]) forms.add(collapseRepeats(form));
  return [...forms];
};

/**
 * Devuelve el término bloqueado que aparece en el texto, o `null` si está
 * limpio. La comparación es SIEMPRE por token entero: por subcadena,
 * "cacahuete" y "cacao" se caerían con "caca".
 */
export function blockedTermIn(text: string): string | null {
  for (const token of tokensOf(text)) {
    const forms = candidateForms(token);
    if (forms.some((f) => FOOD_ALLOWLIST.has(f))) continue;
    const hit = forms.find((f) => BLOCKED_TERMS.has(f));
    if (hit) return hit;
  }
  return null;
}

/** ¿Este texto se puede guardar como comida? */
export const isCleanFood = (text: string): boolean => blockedTermIn(text) === null;

/** Copia de rechazo. Misma frase en las dos plataformas y en los dos caminos. */
export const BLOCKED_FOOD_MESSAGE = "Eso no es comida. Escribe un plato de verdad.";
export const BLOCKED_NAME_MESSAGE = "Ese nombre no vale. Escribe uno de verdad.";
/**
 * Texto que no dice qué se comió ("algo rápido", "lo de siempre"): no se
 * inventa un plato ni un promedio, se le pide a la persona que concrete (ticket
 * 13 de `precision-nutricional`, D13). La hoja de "comí distinto" reconoce este
 * mensaje exacto para quedarse abierta y ofrecer apuntar las kcal a mano.
 */
export const VAGUE_DISH_MESSAGE =
  "¿Qué comiste? Concreta un poco el plato, por ejemplo «bocadillo de jamón».";

/**
 * Versión para un `.validator()` de server function: lanza `ValidationError`,
 * que `apiPost` traduce a un 400 con este mensaje tal cual en pantalla.
 */
export function assertCleanFood(text: string): void {
  if (blockedTermIn(text)) throw new ValidationError(BLOCKED_FOOD_MESSAGE);
}
