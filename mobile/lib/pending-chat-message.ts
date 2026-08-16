// Puente para llevar un mensaje redactado fuera de la pantalla de chat (p.ej.
// desde el registro guiado abierto en Hoy) hasta la conversación del coach.
// En la web esto usa sessionStorage; en RN no existe, así que basta una
// variable en memoria del módulo: el proceso de la app persiste entre pantallas
// y el mensaje solo tiene que sobrevivir a una navegación.
let pending: string | null = null;

export function setPendingChatMessage(text: string) {
  pending = text;
}

export function consumePendingChatMessage(): string | null {
  const value = pending;
  pending = null;
  return value;
}
