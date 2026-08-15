/** @type {import('tailwindcss').Config} */
// NativeWind v4 va con Tailwind v3 (no v4): la v4 quitó la API de configuración
// en la que se apoya y la combinación no genera ningún estilo, sin avisar.
//
// La paleta es el tema "niebla" de la web (:root en src/styles.css), convertido
// de oklch() a hex porque React Native no sabe leer oklch. Si allí se retoca un
// color, hay que reconvertirlo aquí: son dos copias, no una fuente compartida.
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        background: "#f6fafd",
        foreground: "#1d2a37",
        surface: "#ffffff",
        card: "#ffffff",
        "card-foreground": "#1d2a37",
        primary: "#4f8ac6",
        "primary-foreground": "#f9fcff",
        "primary-soft": "#d8ebfb",
        secondary: "#e7f0f7",
        "secondary-foreground": "#2a394a",
        muted: "#ecf2f8",
        "muted-foreground": "#677380",
        accent: "#ceeff5",
        "accent-foreground": "#1e2f41",
        danger: "#e24947",
        "danger-foreground": "#f9fcff",
        warning: "#e19600",
        "warning-foreground": "#2b1f11",
        border: "#dce4ec",
        input: "#dce4ec",
      },
      borderRadius: {
        // --radius: 1.25rem en la web
        xl: 20,
        "2xl": 28,
      },
    },
  },
  plugins: [],
};
