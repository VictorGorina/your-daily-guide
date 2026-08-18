export const THEMES = [
  { id: "peppers", label: "Peppers verde", swatch: ["#F3F1ED", "#EAE6DD", "#6DBE7B"] },
  { id: "mostaza", label: "Mostaza dorado", swatch: ["#F3F1ED", "#EAE6DD", "#F2C14E"] },
  { id: "naranja", label: "Naranja cálido", swatch: ["#F3F1ED", "#EAE6DD", "#FF8A3D"] },
  { id: "noche", label: "Noche serena", swatch: ["#24221F", "#2C2A26", "#7FCB8D"] },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

// Migraciones de nombres de tema de versiones anteriores de la app (Senda).
const LEGACY_MIGRATIONS: Record<string, ThemeId> = {
  niebla: "peppers",
  senda: "peppers",
  salvia: "mostaza",
  arena: "naranja",
};

function migrate(id: string | null | undefined): ThemeId {
  if (!id) return "peppers";
  const mapped = LEGACY_MIGRATIONS[id] ?? id;
  return THEMES.some((t) => t.id === mapped) ? (mapped as ThemeId) : "peppers";
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
  if (typeof window === "undefined") return "peppers";
  try {
    const v = localStorage.getItem("senda-theme") ?? localStorage.getItem("dg-theme");
    return migrate(v);
  } catch {
    return "peppers";
  }
}
