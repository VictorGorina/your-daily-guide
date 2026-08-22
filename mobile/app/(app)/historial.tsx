import { Redirect } from "expo-router";

// Historial vive ahora como tercera sub-pestaña de Plan (ver plan.tsx). Esta
// pantalla se conserva solo para no romper enlaces antiguos a /historial.
export default function Historial() {
  return <Redirect href="/plan?tab=historial" />;
}
