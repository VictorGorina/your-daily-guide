import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * CAPTCHA de Cloudflare Turnstile en la pantalla de acceso (ticket 29 de la
 * auditoría). Sin `VITE_TURNSTILE_SITE_KEY` no carga nada ni pinta nada, y
 * `getToken` devuelve `undefined`: la app funciona como antes.
 *
 * El token se pide justo antes de cada llamada de Auth (vale para una sola) y
 * casi siempre sale sin que la persona vea nada; si Cloudflare duda, el reto
 * aparece en el hueco de `slot` con un aviso encima.
 *
 * La espera tiene dos fases, y cualquier fallo de Cloudflare (error, navegador
 * no soportado, reto caducado) la corta en el momento: antes solo había un
 * tope de 60 s y la persona se quedaba ese rato en "Creando perfil…" sin saber
 * que tenía que marcar una casilla.
 *
 * En el navegador integrado de la app de Claude no hay token posible: Cloudflare
 * pide la casilla, pero ese navegador no pinta los iframes de otro sitio, y el
 * reto es uno (2026-10-25: en su panel, un iframe de control del mismo origen se
 * pinta y uno de otro sitio no). Ahí el aviso sale sobre un hueco vacío y se
 * sigue sin token a los 30 s. No es un fallo de este código ni se arregla aquí:
 * bajar `INTERACTIVE_TIMEOUT_MS` solo quitaría tiempo a quien sí ve la casilla.
 * En local, sin clave de sitio, no hay espera.
 */

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
/**
 * Hasta que Cloudflare da el token o pide la casilla, contando la carga del
 * script. Medido: pide la casilla a los 3,4 s.
 */
export const INVISIBLE_TIMEOUT_MS = 10_000;
/**
 * Con la casilla a la vista: tiempo para verla y marcarla. Se cuenta una vez
 * por intento (un reto que vuelve a salir no lo alarga). Pasado, se sigue sin
 * token; si el servidor lo exige, la persona ve el error y vuelve a probar.
 */
export const INTERACTIVE_TIMEOUT_MS = 30_000;

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      execution: "execute";
      appearance: "interaction-only";
      retry: "never";
      callback: (token: string) => void;
      /** Devolver `true` lo da por tratado: Cloudflare no lo repite en consola. */
      "error-callback": (code: string) => boolean;
      "timeout-callback": () => void;
      "unsupported-callback": () => void;
      "before-interactive-callback": () => void;
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

/** Un `getToken` en curso. */
type Wait = {
  finish: (token: string | undefined) => void;
  timer: number;
  /** Cloudflare ya pidió la casilla en este intento. */
  interactive: boolean;
};

export function useTurnstile() {
  const { t } = useTranslation();
  const container = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const waiting = useRef<Wait | null>(null);
  const [needsInteraction, setNeedsInteraction] = useState(false);

  /** Cierra la espera en curso, si la hay, con el token o sin él. */
  const settle = useCallback((token: string | undefined) => {
    const wait = waiting.current;
    if (!wait) return;
    waiting.current = null;
    window.clearTimeout(wait.timer);
    setNeedsInteraction(false);
    wait.finish(token);
  }, []);

  /** (Re)programa el tope de la espera; si salta, se sigue sin token. */
  const arm = useCallback(
    (wait: Wait, ms: number) => {
      window.clearTimeout(wait.timer);
      wait.timer = window.setTimeout(() => {
        if (waiting.current !== wait) return;
        settle(undefined);
        // Un reto que ya nadie espera no se queda a la vista: el siguiente
        // intento pide uno nuevo.
        if (widgetId.current) window.turnstile?.reset(widgetId.current);
      }, ms);
    },
    [settle],
  );

  useEffect(() => {
    if (!SITE_KEY) return;
    // Se carga al montar la pantalla, no al pulsar: el primer token sale antes.
    void loadTurnstile();
    return () => {
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
      settle(undefined);
    };
  }, [settle]);

  /**
   * Un token nuevo para la llamada que viene, o `undefined` si no hay CAPTCHA
   * configurado o Cloudflare no lo da a tiempo. Sin token la llamada se hace
   * igual: quien decide si pasa es el servidor (o Supabase), no esta pantalla.
   */
  const getToken = useCallback((): Promise<string | undefined> => {
    if (!SITE_KEY || !container.current) return Promise.resolve(undefined);
    settle(undefined);

    return new Promise<string | undefined>((resolve) => {
      const wait: Wait = { finish: resolve, timer: 0, interactive: false };
      waiting.current = wait;
      arm(wait, INVISIBLE_TIMEOUT_MS);

      void loadTurnstile().then((api) => {
        // El tope saltó mientras cargaba, o ya hay otro intento en marcha.
        if (waiting.current !== wait) return;
        if (!api || !container.current) return settle(undefined);
        try {
          if (widgetId.current) {
            api.reset(widgetId.current);
          } else {
            widgetId.current = api.render(container.current, {
              sitekey: SITE_KEY,
              execution: "execute",
              appearance: "interaction-only",
              // Sin reintentos por su cuenta: el siguiente `getToken` hace `reset`.
              retry: "never",
              callback: (token) => settle(token),
              "error-callback": (code) => {
                console.warn("acceso: el CAPTCHA ha fallado", code);
                settle(undefined);
                return true;
              },
              // Cloudflare cierra un reto sin marcar (~2 min) y lo reinicia él.
              "timeout-callback": () => settle(undefined),
              "unsupported-callback": () => {
                console.warn("acceso: este navegador no admite el CAPTCHA");
                settle(undefined);
              },
              "before-interactive-callback": () => {
                const current = waiting.current;
                if (!current || current.interactive) return;
                current.interactive = true;
                arm(current, INTERACTIVE_TIMEOUT_MS);
                setNeedsInteraction(true);
              },
            });
          }
          api.execute(widgetId.current);
        } catch (error) {
          console.warn("acceso: el CAPTCHA no ha arrancado", error);
          settle(undefined);
        }
      });
    });
  }, [arm, settle]);

  // La casilla sale en el pie, lejos del botón que se pulsó: se lleva a la vista.
  useEffect(() => {
    if (needsInteraction) area.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [needsInteraction]);

  /**
   * Hueco donde aparece el reto cuando hace falta; vacío (y sin alto) el resto
   * del tiempo. El aviso es una región `status` que está siempre, para que un
   * lector de pantalla lo anuncie al aparecer.
   */
  const slot = SITE_KEY ? (
    <div
      ref={area}
      className={`flex flex-col items-center${needsInteraction ? " gap-2 pb-3" : ""}`}
    >
      <p role="status" className="text-center text-xs text-muted-foreground">
        {needsInteraction ? t("auth.captchaHint") : null}
      </p>
      <div ref={container} className="flex justify-center empty:hidden" />
    </div>
  ) : null;

  return { slot, getToken };
}
