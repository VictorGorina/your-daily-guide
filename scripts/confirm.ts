/**
 * Confirmación antes de escribir en la base de datos real desde un script con la
 * clave de servicio (ticket 19 de la auditoría, OPS-04). Imprime qué se va a
 * cambiar y pide `s/N`; `--yes` se la salta, para un uso consciente.
 *
 * Sin terminal interactiva (un agente, una tubería) no se puede preguntar, así
 * que se responde «no»: escribir exige `--yes` explícito.
 */
import { createInterface } from "node:readline/promises";

export async function confirmWrite(summary: string, yes: boolean | undefined): Promise<boolean> {
  console.log(summary);
  if (yes) return true;
  if (!process.stdin.isTTY) {
    console.error("Sin terminal interactiva no se puede confirmar: repite con --yes.");
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question("¿Seguir? (s/N) ");
    return /^s[ií]?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}
