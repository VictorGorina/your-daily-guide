import { useCallback, useEffect, useRef } from "react";

/**
 * CAPTCHA de Cloudflare Turnstile en la pantalla de acceso (ticket 29 de la
 * auditoría). Sin `VITE_TURNSTILE_SITE_KEY` no carga nada ni pinta nada, y
 * `getToken` devuelve `undefined`: la app funciona como antes.
 *
 * El token se pide justo antes de cada llamada de Auth (vale para una sola) y
 * casi siempre sale sin que la persona vea nada; si Cloudflare duda, el reto
 * aparece en el hueco de `slot`.
 */

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
/** Con un reto a la vista la persona necesita su tiempo; sin respuesta, se sigue sin token. */
const TOKEN_TIMEOUT_MS = 60_000;

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      execution: "execute";
      appearance: "interaction-only";
      callback: (token: string) => void;
      "error-callback": () => void;
      "timeout-callback": () => void;
    },
  ) => string;
  execute: (widgetId: string) => void;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptLoading: Promise<TurnstileApi | null> | null = null;

/** Carga el script de Cloudflare una sola vez por página. */
function loadTurnstile(): Promise<TurnstileApi | null> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptLoading ??= new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve(window.turnstile ?? null);
    script.onerror = () => {
      console.warn("acceso: no se ha podido cargar el CAPTCHA");
      scriptLoading = null;
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return scriptLoading;
}

export function useTurnstile() {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const waiting = useRef<((token: string | undefined) => void) | null>(null);

  const settle = (token: string | undefined) => {
    waiting.current?.(token);
    waiting.current = null;
  };

  useEffect(() => {
    if (!SITE_KEY) return;
    // Se carga al montar la pantalla, no al pulsar: el primer token sale antes.
    void loadTurnstile();
    return () => {
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
      settle(undefined);
    };
  }, []);

  /**
   * Un token nuevo para la llamada que viene, o `undefined` si no hay CAPTCHA
   * configurado o Cloudflare no responde. Sin token la llamada se hace igual:
   * quien decide si pasa es el servidor (o Supabase), no esta pantalla.
   */
  const getToken = useCallback(async (): Promise<string | undefined> => {
    if (!SITE_KEY || !container.current) return undefined;
    const api = await loadTurnstile();
    if (!api || !container.current) return undefined;
    settle(undefined);

    return new Promise<string | undefined>((resolve) => {
      const timer = window.setTimeout(() => settle(undefined), TOKEN_TIMEOUT_MS);
      waiting.current = (token) => {
        window.clearTimeout(timer);
        resolve(token);
      };
      if (widgetId.current) {
        api.reset(widgetId.current);
      } else {
        widgetId.current = api.render(container.current!, {
          sitekey: SITE_KEY,
          execution: "execute",
          appearance: "interaction-only",
          callback: (token) => settle(token),
          "error-callback": () => settle(undefined),
          "timeout-callback": () => settle(undefined),
        });
      }
      api.execute(widgetId.current);
    });
  }, []);

  /** Hueco donde aparece el reto cuando hace falta; vacío el resto del tiempo. */
  const slot = SITE_KEY ? (
    <div ref={container} className="flex justify-center empty:hidden" />
  ) : null;

  return { slot, getToken };
}
