/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
// Config del target del widget (WidgetKit). Lo lee @bacons/apple-targets en cada
// `expo prebuild` y enlaza esta carpeta como extensión en el proyecto Xcode
// generado, sin tocar `ios/` a mano (ver AGENTS.md).
module.exports = (config) => ({
  type: "widget",
  name: "DailyGuideWidget",
  displayName: "Peppers",
  icon: "../../assets/icon.png",
  // iOS 17 es el mínimo por `containerBackground(for: .widget)`, obligatorio
  // desde esa versión para que el widget pinte fondo en todos los contextos.
  deploymentTarget: "17.0",
  frameworks: ["SwiftUI", "WidgetKit"],
  // Colores globales del target: acento (tinte de botones al editar el widget)
  // y fondo del widget. Paleta Peppers de la app (tailwind.config.js).
  colors: {
    $accent: "#6dbe7b",
    $widgetBackground: { color: "#f3f1ed", darkColor: "#24221f" },
  },
  // Mismo App Group que la app, para leer el "snapshot del día" que ella escribe.
  // Se hereda de `ios.entitlements` de app.json (una sola fuente de verdad).
  entitlements: {
    "com.apple.security.application-groups":
      config.ios.entitlements["com.apple.security.application-groups"],
  },
});
