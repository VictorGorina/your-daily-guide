import AsyncStorage from "@react-native-async-storage/async-storage";

import { clearPendingChatMessage } from "./pending-chat-message";
import { STORAGE_OWNER_KEY, isUserKey, localDataAction } from "./user-storage";

/**
 * Lo que una persona deja en el dispositivo se borra al salir o cuando entra
 * otra cuenta (ticket 18, MOB-04; la regla está en `user-storage.ts`). Copia de
 * `src/lib/local-user-data.ts` de la web, con AsyncStorage en vez de
 * `localStorage`.
 */

/** Borra el borrador del onboarding, los pendientes del día y del plan, y su dueño. */
export async function clearLocalUserData(): Promise<void> {
  clearPendingChatMessage();
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter(isUserKey);
    if (mine.length) await AsyncStorage.multiRemove(mine);
  } catch (error) {
    console.warn("local-user-data: borrar lo guardado al salir", error);
  }
}

/** Aplica a lo guardado lo que toca con cada evento de sesión. Nunca lanza. */
export async function syncLocalUserData(event: string, userId: string | null): Promise<void> {
  try {
    const owner = await AsyncStorage.getItem(STORAGE_OWNER_KEY);
    const action = localDataAction(event, owner, userId);
    if (action === "clear" || action === "switch") await clearLocalUserData();
    if ((action === "switch" || action === "claim") && userId) {
      await AsyncStorage.setItem(STORAGE_OWNER_KEY, userId);
    }
  } catch (error) {
    console.warn("local-user-data: revisar de quién es lo guardado", error);
  }
}
