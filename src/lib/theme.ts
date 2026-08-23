// Solo dos temas: claro y oscuro. El acento naranja es fijo en ambos (§2/§9
// del guideline: "un solo naranja por pantalla" — no hay selector de acento).
export const THEMES = [
  { id: "claro", label: "Claro", swatch: ["#F3F1ED", "#EAE6DD", "#FF8A3D"] },
  { id: "oscuro", label: "Oscuro", swatch: ["#24221F", "#2C2A26", "#FF9D5C"] },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

// Migraciones de nombres de tema de versiones anteriores (Senda, y el
// selector de 4 acentos que hubo antes de converger a solo claro/oscuro).
const LEGACY_MIGRATIONS: Record<string, ThemeId> = {
  niebla: "claro",
  senda: "claro",
  salvia: "claro",
  arena: "claro",
  peppers: "claro",
  mostaza: "claro",
  naranja: "claro",
  noche: "oscuro",
};

function migrate(id: string | null | undefined): ThemeId {
  if (!id) return "claro";
  const mapped = LEGACY_MIGRATIONS[id] ?? id;
  return THEMES.some((t) => t.id === mapped) ? (mapped as ThemeId) : "claro";
}

export function applyTheme(theme: string | null | undefined) {
  if (typeof document === "undefined") return;
  const id = migrate(theme);
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem("senda-theme", id);
  } catch {
    /* ignore */
  }
}

export function storedTheme(): ThemeId {
  if (typeof window === "undefined") return "claro";
  try {
    const v = localStorage.getItem("senda-theme") ?? localStorage.getItem("dg-theme");
    return migrate(v);
  } catch {
    return "claro";
  }
}

/** Tema del sistema operativo, para usarlo como valor inicial si la persona
 * usuaria no ha elegido nunca uno a mano. */
export function systemTheme(): ThemeId {
  if (typeof window === "undefined" || !window.matchMedia) return "claro";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "oscuro" : "claro";
}
