export const THEMES = [
  { id: "niebla", label: "Azul niebla", swatch: ["#F6F9FC", "#DCE7F2", "#5B87C4"] },
  { id: "salvia", label: "Verde salvia", swatch: ["#F7F9F6", "#DCE8DC", "#6F9E7C"] },
  { id: "arena", label: "Arena cálida", swatch: ["#FBF8F3", "#EFE3D3", "#C98B5E"] },
  { id: "noche", label: "Noche serena", swatch: ["#1F2530", "#2B3341", "#8FB0E0"] },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export function applyTheme(theme: string | null | undefined) {
  if (typeof document === "undefined") return;
  const id = THEMES.some((t) => t.id === theme) ? (theme as ThemeId) : "niebla";
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem("dg-theme", id);
  } catch {
    /* ignore */
  }
}

export function storedTheme(): ThemeId {
  if (typeof window === "undefined") return "niebla";
  try {
    const v = localStorage.getItem("dg-theme");
    return THEMES.some((t) => t.id === v) ? (v as ThemeId) : "niebla";
  } catch {
    return "niebla";
  }
}
