import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AccessibilityInfo, Platform, Text, TurboModuleRegistry, View } from "react-native";
import type { WebViewMessageEvent, WebViewProps } from "react-native-webview";

import { API_BASE_URL } from "../lib/api";
import {
  CAPTCHA_PAGE_PATH,
  INTERACTIVE_TIMEOUT_MS,
  INVISIBLE_TIMEOUT_MS,
  parseCaptchaMessage,
} from "../lib/captcha-bridge";

/**
 * CAPTCHA de Cloudflare Turnstile en la pantalla de acceso (ticket 29), la
 * pareja de `src/components/turnstile-widget.tsx` de la web: la misma forma
 * (`{ slot, getToken }`), los mismos topes (`captcha-bridge.ts`) y el mismo
 * aviso cuando Cloudflare pide la casilla.
 *
 * El reto lo pinta una página de la web (`CAPTCHA_PAGE_PATH`) dentro de un
 * WebView, una página por token: Cloudflare solo da token en los dominios del
 * widget. Mientras no pida la casilla el WebView no se ve (1 pt de alto y
 * transparente); si la pide, crece a su tamaño con el aviso encima.
 *
 * `react-native-webview` es un módulo nativo: en una build anterior a su
 * prebuild no está, `getToken` devuelve `undefined` sin esperar y la llamada
 * sigue sin token, como antes (quien decide si pasa es el servidor). Con el
 * servidor sin clave de sitio, la página dice «off» y tampoco se espera.
 */

const PAGE_URL = `${API_BASE_URL}${CAPTCHA_PAGE_PATH}`;
/** El widget «normal» de Turnstile mide 300 × 65. */
const WIDGET_WIDTH = 300;
const WIDGET_HEIGHT = 70;

type WebViewComponent = typeof import("react-native-webview").WebView;
type LoadRequest = Parameters<NonNullable<WebViewProps["onShouldStartLoadWithRequest"]>>[0];

let webViewLoading: Promise<WebViewComponent | null> | null = null;

/**
 * El WebView, o `null` si esta build no lo trae (o en `expo start --web`, que no
 * tiene módulos nativos). Se mira una vez por arranque.
 */
function loadWebView(): Promise<WebViewComponent | null> {
  webViewLoading ??=
    Platform.OS !== "web" && TurboModuleRegistry.get("RNCWebViewModule")
      ? import("react-native-webview")
          .then((module) => module.WebView)
          .catch((error) => {
            console.warn("acceso: no se ha podido cargar el CAPTCHA", error);
            return null;
          })
      : Promise.resolve(null);
  return webViewLoading;
}

/** El servidor no tiene clave de sitio: no se vuelve a preguntar hasta reabrir la app. */
let captchaOff = false;

/** Un `getToken` en curso. */
type Wait = {
  finish: (token: string | undefined) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** Cloudflare ya pidió la casilla en este intento. */
  interactive: boolean;
};

export function useTurnstile() {
  const { t } = useTranslation();
  const [WebView, setWebView] = useState<WebViewComponent | null>(null);
  /** El intento en curso (`null`: ninguno). Cada uno monta un WebView nuevo. */
  const [attempt, setAttempt] = useState<number | null>(null);
  const attempts = useRef(0);
  const waiting = useRef<Wait | null>(null);
  const [needsInteraction, setNeedsInteraction] = useState(false);

  /** Cierra la espera en curso, si la hay, con el token o sin él, y quita el WebView. */
  const settle = useCallback((token: string | undefined) => {
    const wait = waiting.current;
    if (!wait) return;
    waiting.current = null;
    clearTimeout(wait.timer);
    setNeedsInteraction(false);
    setAttempt(null);
    wait.finish(token);
  }, []);

  /** (Re)programa el tope de la espera; si salta, se sigue sin token. */
  const arm = useCallback(
    (wait: Wait, ms: number) => {
      clearTimeout(wait.timer);
      wait.timer = setTimeout(() => {
        if (waiting.current === wait) settle(undefined);
      }, ms);
    },
    [settle],
  );

  useEffect(() => {
    let alive = true;
    void loadWebView().then((component) => {
      if (alive) setWebView(() => component);
    });
    return () => {
      alive = false;
      settle(undefined);
    };
  }, [settle]);

  /**
   * Un token nuevo para la llamada que viene, o `undefined` si no hay CAPTCHA
   * o Cloudflare no lo da a tiempo. Sin token la llamada se hace igual.
   */
  const getToken = useCallback(async (): Promise<string | undefined> => {
    if (captchaOff) return undefined;
    const component = await loadWebView();
    if (!component) return undefined;
    setWebView(() => component);
    settle(undefined);

    return new Promise<string | undefined>((resolve) => {
      const wait: Wait = { finish: resolve, timer: undefined, interactive: false };
      waiting.current = wait;
      arm(wait, INVISIBLE_TIMEOUT_MS);
      attempts.current += 1;
      setAttempt(attempts.current);
    });
  }, [arm, settle]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      // Solo la página del reto habla con la app.
      if (!event.nativeEvent.url.startsWith(PAGE_URL)) return;
      const message = parseCaptchaMessage(event.nativeEvent.data);
      const wait = waiting.current;
      if (!message || !wait) return;
      switch (message.type) {
        case "token":
          settle(message.token);
          return;
        case "interactive":
          if (wait.interactive) return;
          wait.interactive = true;
          arm(wait, INTERACTIVE_TIMEOUT_MS);
          setNeedsInteraction(true);
          AccessibilityInfo.announceForAccessibility(t("auth.captchaHint"));
          return;
        case "off":
          captchaOff = true;
          settle(undefined);
          return;
        case "error":
          console.warn("acceso: el CAPTCHA ha fallado", message.code);
          settle(undefined);
          return;
        case "unsupported":
          console.warn("acceso: este dispositivo no admite el CAPTCHA");
          settle(undefined);
          return;
        case "timeout":
          settle(undefined);
          return;
      }
    },
    [arm, settle, t],
  );

  /**
   * El marco principal no sale de la página del reto (los enlaces del widget no
   * abren nada); el iframe de Cloudflare carga dentro sin pasar por aquí.
   */
  const onShouldStartLoadWithRequest = useCallback(
    (request: LoadRequest) => request.isTopFrame === false || request.url.startsWith(PAGE_URL),
    [],
  );

  const onLoadFailed = useCallback(() => {
    // Sin red, o un servidor anterior a la página (404): se sigue sin token.
    console.warn("acceso: no se ha podido abrir el CAPTCHA");
    settle(undefined);
  }, [settle]);

  /** Hueco donde aparece el reto cuando hace falta; nada el resto del tiempo. */
  const slot =
    attempt !== null && WebView ? (
      <View className={needsInteraction ? "items-center gap-2 pb-3" : "items-center"}>
        {needsInteraction ? (
          <Text className="text-center text-xs font-body text-muted-foreground">
            {t("auth.captchaHint")}
          </Text>
        ) : null}
        <View
          pointerEvents={needsInteraction ? "auto" : "none"}
          style={{
            width: WIDGET_WIDTH,
            height: needsInteraction ? WIDGET_HEIGHT : 1,
            opacity: needsInteraction ? 1 : 0,
          }}
        >
          <WebView
            key={attempt}
            source={{ uri: PAGE_URL }}
            onMessage={onMessage}
            onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
            onError={onLoadFailed}
            onHttpError={onLoadFailed}
            setSupportMultipleWindows={false}
            scrollEnabled={false}
            bounces={false}
            style={{ backgroundColor: "transparent" }}
          />
        </View>
      </View>
    ) : null;

  return { slot, getToken };
}
