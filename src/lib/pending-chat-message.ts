// Pequeño puente para llevar un mensaje redactado fuera de /chat (p.ej. desde el
// registro guiado abierto en hoy.tsx) hasta la conversación real del coach, sin
// duplicar la lógica de streaming/tools que ya vive en chat.tsx.
const KEY = "ydg:pendingChatMessage";

export function setPendingChatMessage(text: string) {
  try {
    sessionStorage.setItem(KEY, text);
  } catch {
    // Modo privado u otro bloqueo de storage: no es crítico, se pierde el mensaje.
  }
}

export function consumePendingChatMessage(): string | null {
  try {
    const value = sessionStorage.getItem(KEY);
    if (value) sessionStorage.removeItem(KEY);
    return value;
  } catch {
    return null;
  }
}
