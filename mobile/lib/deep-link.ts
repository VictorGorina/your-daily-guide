import * as Linking from "expo-linking";
import { useEffect, useState } from "react";

/**
 * Última URL con la que se ha abierto la app, incluido el fragmento.
 *
 * Hace falta porque expo-router consume el deep link para navegar pero solo
 * expone la query (`useLocalSearchParams`), no el fragmento — y Supabase manda
 * ahí cosas que necesitamos: `#error=…&error_code=otp_expired` cuando un enlace
 * ha caducado, y `#access_token=…&refresh_token=…` cuando el enlace se generó
 * fuera del flujo PKCE.
 *
 * `Linking.useURL()` no vale: combina `getInitialURL()` (que solo trae algo si
 * el deep link arrancó la app) con un listener que se suscribe al montar la
 * pantalla. Con la app ya abierta, para cuando la pantalla monta el evento
 * `url` ya ha pasado y se pierde — devuelve `null`. Por eso escuchamos desde
 * que se carga este módulo, que se importa en el layout raíz (app/_layout.tsx)
 * y por tanto está activo antes de cualquier navegación.
 */
let lastUrl: string | null = null;
const listeners = new Set<(url: string) => void>();

function remember(url: string) {
  lastUrl = url;
  for (const listener of listeners) listener(url);
}

Linking.getInitialURL().then((url) => {
  // Sin pisar una URL posterior: si ya ha llegado un evento, ese es más nuevo.
  if (url && !lastUrl) remember(url);
});
Linking.addEventListener("url", ({ url }) => remember(url));

/** URL de apertura con su fragmento, o `null` si la app no se abrió por enlace. */
export function useDeepLinkUrl(): string | null {
  const [url, setUrl] = useState<string | null>(lastUrl);

  useEffect(() => {
    // Puede haber llegado entre el primer render y este efecto.
    if (lastUrl) setUrl(lastUrl);
    listeners.add(setUrl);
    return () => {
      listeners.delete(setUrl);
    };
  }, []);

  return url;
}
