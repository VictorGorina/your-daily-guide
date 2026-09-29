import { clearPendingChatMessage } from "@/lib/pending-chat-message";
import { STORAGE_OWNER_KEY, isUserKey, localDataAction } from "@/lib/user-storage";

/**
 * Lo que una persona deja en el navegador se borra al salir o cuando entra
 * otra cuenta (ticket 18, MOB-04; la regla está en `user-storage.ts`). Copia en
 * `mobile/lib/local-user-data.ts`, con AsyncStorage.
 */

/** Borra el borrador del onboarding, los pendientes del día y del plan, y su dueño. */
export function clearLocalUserData(): void {
  clearPendingChatMessage();
  try {
    // Primero se reúnen y luego se borran: borrar al recorrer mueve los índices.
    const mine: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && isUserKey(key)) mine.push(key);
    }
    for (const key of mine) localStorage.removeItem(key);
  } catch (error) {
    console.warn("local-user-data: borrar lo guardado al salir", error);
  }
}

/** Aplica a lo guardado lo que toca con cada evento de sesión. Nunca lanza. */
export function syncLocalUserData(event: string, userId: string | null): void {
  try {
    const action = localDataAction(event, localStorage.getItem(STORAGE_OWNER_KEY), userId);
    if (action === "clear" || action === "switch") clearLocalUserData();
    if ((action === "switch" || action === "claim") && userId) {
      localStorage.setItem(STORAGE_OWNER_KEY, userId);
    }
  } catch (error) {
    console.warn("local-user-data: revisar de quién es lo guardado", error);
  }
}
