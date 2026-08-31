import { Redirect } from "expo-router";

// Historial se fundió en la subpestaña Plan (el calendario del mes es el
// navegador del historial). Esta pantalla se conserva solo para no romper
// enlaces antiguos a /historial.
export default function Historial() {
  return <Redirect href="/plan" />;
}
