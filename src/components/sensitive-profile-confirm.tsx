import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { sensitiveConfirmCopy, type SensitiveChange } from "@/lib/profile-fields";

/**
 * Confirmación de los cambios sensibles del perfil que propone el coach
 * (ticket 31). `confirm` abre la hoja y resuelve con la respuesta; el chat lo
 * espera dentro de `onToolCall`, así que el resultado de la herramienta no
 * vuelve al modelo hasta que la persona contesta. Cerrar la hoja (Escape,
 * fuera) cuenta como «no». Mismo texto que el Alert del móvil.
 */
export function useSensitiveProfileConfirm() {
  const { t } = useTranslation();
  const [changes, setChanges] = useState<SensitiveChange[] | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const settle = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setChanges(null);
  }, []);

  const confirm = useCallback((next: SensitiveChange[]) => {
    // Una confirmación pendiente que se queda sin contestar cuenta como «no».
    resolver.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setChanges(next);
    });
  }, []);

  const copy = changes ? sensitiveConfirmCopy(changes, t) : null;
  const dialog = (
    <AlertDialog open={copy !== null} onOpenChange={(open) => !open && settle(false)}>
      <AlertDialogContent className="rounded-3xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{copy?.title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <ul className="space-y-1">
                {copy?.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {copy?.note && <p>{copy.note}</p>}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => settle(false)}>{copy?.cancel}</AlertDialogCancel>
          <AlertDialogAction onClick={() => settle(true)}>{copy?.confirm}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirm, dialog };
}
