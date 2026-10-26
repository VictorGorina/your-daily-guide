/**
 * La página del reto de Turnstile que abre el WebView del móvil (ticket 29;
 * ruta `CAPTCHA_PAGE_PATH`). Pinta el widget en cuanto carga y cuenta cada
 * callback a la app con `window.ReactNativeWebView.postMessage`, en el formato
 * que lee `parseCaptchaMessage` (`captcha-bridge.ts`). Los topes de la espera
 * los lleva la app, no la página: si algo no carga, la app deja de esperar
 * igual.
 *
 * Una página por token (vale para una llamada): sin `execution: "execute"`,
 * el reto arranca solo al pintarse. Puro: la clave llega como argumento.
 */

const SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=peppersCaptchaLoaded";

/**
 * Un valor para meter en un `<script>`: JSON, con `<` escapado para que un
 * `</script>` dentro del texto no cierre la etiqueta.
 */
function scriptLiteral(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function captchaPageHtml(siteKey: string | undefined): string {
  const key = scriptLiteral(siteKey?.trim() ?? "");
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Peppers</title>
<style>html,body{margin:0;padding:0;background:transparent}body{display:flex;justify-content:center}</style>
</head>
<body>
<div id="captcha"></div>
<script>
(function () {
  var siteKey = ${key};
  function send(message) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
  }
  if (!siteKey) {
    send({ type: "off" });
    return;
  }
  window.peppersCaptchaLoaded = function () {
    try {
      window.turnstile.render("#captcha", {
        sitekey: siteKey,
        appearance: "interaction-only",
        retry: "never",
        callback: function (token) { send({ type: "token", token: token }); },
        "error-callback": function (code) { send({ type: "error", code: String(code) }); return true; },
        "timeout-callback": function () { send({ type: "timeout" }); },
        "unsupported-callback": function () { send({ type: "unsupported" }); },
        "before-interactive-callback": function () { send({ type: "interactive" }); }
      });
    } catch (error) {
      send({ type: "error", code: "render" });
    }
  };
  var script = document.createElement("script");
  script.src = ${scriptLiteral(SCRIPT_URL)};
  script.async = true;
  script.onerror = function () { send({ type: "error", code: "script" }); };
  document.head.appendChild(script);
})();
</script>
</body>
</html>
`;
}
