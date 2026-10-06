import "react-native-get-random-values";

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as aesjs from "aes-js";
import * as SecureStore from "expo-secure-store";

/**
 * Almacén de la sesión de Supabase, cifrado (ticket 38, MOB-03). Antes la
 * sesión —refresh token incluido— iba en claro en AsyncStorage, que es un
 * archivo de la app sin más protección.
 *
 * Es el patrón «LargeSecureStore» de la documentación de Supabase para Expo:
 * el llavero de iOS (`expo-secure-store`) tiene un límite de tamaño por entrada
 * que la sesión puede superar, así que en el llavero va solo una clave AES de
 * 256 bits y en AsyncStorage la sesión cifrada con ella. Cada escritura estrena
 * clave: con AES-CTR no se puede repetir clave y contador para dos textos.
 *
 * Lo cifrado se guarda con el prefijo `enc1:`. Un valor SIN prefijo es de una
 * versión anterior de la app, en claro: se devuelve y se cifra en ese momento,
 * así que quien actualiza sigue dentro (migración transparente).
 */
const PREFIX = "enc1:";

// La sesión se renueva sola con la app en segundo plano: tiene que poder
// leerse con el móvil bloqueado. No viaja a otros dispositivos ni a copias.
const KEYCHAIN: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

// UTF-8 a mano: `aesjs.utils.utf8.fromBytes` no lee secuencias de 4 bytes, y un
// emoji en el nombre de la cuenta dejaba la sesión ilegible.
function toUtf8(text: string): Uint8Array {
  const encoded = encodeURIComponent(text);
  const bytes: number[] = [];
  for (let i = 0; i < encoded.length; i++) {
    if (encoded[i] === "%") {
      bytes.push(parseInt(encoded.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(encoded.charCodeAt(i));
    }
  }
  return Uint8Array.from(bytes);
}

function fromUtf8(bytes: Uint8Array): string {
  return decodeURIComponent(
    Array.from(bytes, (byte) => `%${byte.toString(16).padStart(2, "0")}`).join(""),
  );
}

async function encrypt(key: string, value: string): Promise<string> {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const cipher = new aesjs.ModeOfOperation.ctr(secret, new aesjs.Counter(1));
  const encrypted = cipher.encrypt(toUtf8(value));
  await SecureStore.setItemAsync(key, aesjs.utils.hex.fromBytes(secret), KEYCHAIN);
  return PREFIX + aesjs.utils.hex.fromBytes(encrypted);
}

async function decrypt(key: string, stored: string): Promise<string | null> {
  const secretHex = await SecureStore.getItemAsync(key, KEYCHAIN);
  if (!secretHex) return null;
  const cipher = new aesjs.ModeOfOperation.ctr(
    aesjs.utils.hex.toBytes(secretHex),
    new aesjs.Counter(1),
  );
  const bytes = cipher.decrypt(aesjs.utils.hex.toBytes(stored.slice(PREFIX.length)));
  return fromUtf8(bytes);
}

export const secureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    const stored = await AsyncStorage.getItem(key);
    if (stored === null) return null;
    if (!stored.startsWith(PREFIX)) {
      // De una versión anterior, en claro: se cifra ya. Si no se pudiera, se
      // sigue con lo leído y se reintenta en el siguiente arranque.
      try {
        await AsyncStorage.setItem(key, await encrypt(key, stored));
      } catch (error) {
        console.warn("sesión: cifrar la sesión guardada", error);
      }
      return stored;
    }
    try {
      const value = await decrypt(key, stored);
      // Sin clave en el llavero (copia restaurada en otro móvil) no hay sesión.
      if (value === null) await AsyncStorage.removeItem(key);
      return value;
    } catch (error) {
      console.warn("sesión: leer la sesión cifrada", error);
      await AsyncStorage.removeItem(key);
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    await AsyncStorage.setItem(key, await encrypt(key, value));
  },

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(key, KEYCHAIN);
  },
};
