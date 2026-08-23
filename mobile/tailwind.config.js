/** @type {import('tailwindcss').Config} */
// NativeWind v4 va con Tailwind v3 (no v4): la v4 quitó la API de configuración
// en la que se apoya y la combinación no genera ningún estilo, sin avisar.
//
// La paleta es el tema "claro" de la web (:root en src/styles.css), con el
// naranja Peppers como único acento (no hay theming en runtime en móvil, ver
// AGENTS.md). React Native no entiende oklch/color-mix, así que aquí son los
// mismos hex ya calculados a mano: si se retoca uno allí, hay que
// reconvertirlo aquí — son dos copias, no una fuente compartida.
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        background: "#f3f1ed",
        foreground: "#3e3d39",
        surface: "#fbfaf7",
        card: "#fbfaf7",
        "card-foreground": "#3e3d39",
        primary: "#ff8a3d",
        "primary-foreground": "#fbfaf7",
        "primary-soft": "#ffe7d3",
        secondary: "#eae6dd",
        "secondary-foreground": "#3e3d39",
        muted: "#eeeae2",
        "muted-foreground": "#83796c",
        accent: "#efe7da",
        "accent-foreground": "#3e3d39",
        danger: "#e2685f",
        "danger-foreground": "#fbfaf7",
        warning: "#f2c14e",
        "warning-foreground": "#3e2f12",
        success: "#4cae64",
        "success-foreground": "#fbfaf7",
        "success-soft": "#e1f2e4",
        destructive: "#e2685f",
        "destructive-foreground": "#fbfaf7",
        border: "#e2dcd0",
        input: "#e2dcd0",
        // Colores de categoría de alimento (spec §4) — usar siempre a baja
        // opacidad como fondo de tarjeta (ej. bg-category-verdura/15).
        "category-verdura": "#6dbe7b",
        "category-pescado": "#4c9bd6",
        "category-carne": "#e57373",
        "category-aves": "#f2c14e",
        "category-cereales": "#d7b58a",
        "category-fruta": "#ff8a3d",
        "category-lacteos": "#f5e6c8",
        "category-legumbres": "#9a7655",
      },
      fontFamily: {
        // Cuerpo/UI — Work Sans sigue disponible para componentes que aún lo usen.
        sans: ["WorkSans_400Regular"],
        "sans-medium": ["WorkSans_500Medium"],
        "sans-semibold": ["WorkSans_600SemiBold"],
        "sans-bold": ["WorkSans_700Bold"],
        // Títulos — Fraunces sigue para componentes legacy.
        display: ["Fraunces_600SemiBold"],
        // Rediseño Hoy (artboard 1b) — Outfit para headings, Figtree para body, DM Mono para datos.
        heading: ["Outfit_600SemiBold"],
        "heading-medium": ["Outfit_500Medium"],
        "heading-bold": ["Outfit_700Bold"],
        body: ["Figtree_400Regular"],
        "body-medium": ["Figtree_500Medium"],
        "body-semibold": ["Figtree_600SemiBold"],
        mono: ["DMMono_400Regular"],
        "mono-medium": ["DMMono_500Medium"],
      },
      borderRadius: {
        // Botones 10–12px, cards 12–16px, elementos destacados hasta ~18px
        // (spec §7) — más moderado que las cápsulas de antes.
        sm: 6,
        md: 9,
        lg: 12,
        xl: 16,
        "2xl": 22,
        "3xl": 30,
      },
    },
  },
  plugins: [],
};
