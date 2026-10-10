// Puertas del móvil (ticket 27 de la auditoría): la configuración de Expo, que
// incluye las reglas de hooks de React. Corre en el job `mobile` de CI.
//
// eslint va fijado a ^9: eslint-plugin-react (dentro de eslint-config-expo) aún
// usa `context.getFilename()`, que ESLint 10 quitó. `legacy-peer-deps` en
// .npmrc calla ese choque al instalar, así que no lo subas sin probar `npx eslint .`.
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // `ios/` lo genera `expo prebuild`; `dist/`, `expo export`.
    ignores: ["dist/*", "ios/*", ".expo/*"],
  },
  {
    rules: {
      // Reglas de React Compiler que trae eslint-plugin-react-hooks 7. Marcan
      // efectos de Hoy, Plan y Chat que hoy funcionan; reescribirlos es otro
      // trabajo. Aviso, no error: siguen a la vista en cada ejecución sin frenar
      // el job. La web hace lo mismo en su eslint.config.js.
      "react-hooks/globals": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      // Protege de entidades HTML mal escritas en JSX de navegador. En React
      // Native el texto no pasa por un parser HTML: una `"` en <Text> es texto.
      "react/no-unescaped-entities": "off",
    },
  },
]);
