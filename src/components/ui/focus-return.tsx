"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

/**
 * Devolver el foco a quien abrió un panel (A11Y-04). Al cerrar, Radix enfoca su
 * propio `Trigger` y cancela lo demás; un panel abierto por estado
 * (`<Sheet open={…}>`, sin trigger) dejaba el foco en `<body>` y quien usa
 * teclado o lector de pantalla perdía su sitio. Lo comparten `sheet.tsx` y
 * `dialog.tsx`, que salen del mismo primitivo.
 */

/** Si el panel tiene un `Trigger` montado: entonces el foco es cosa de Radix. */
const HasTriggerContext = React.createContext<React.MutableRefObject<boolean> | null>(null);

function FocusReturnRoot(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  const hasTrigger = React.useRef(false);
  return (
    <HasTriggerContext.Provider value={hasTrigger}>
      <DialogPrimitive.Root {...props} />
    </HasTriggerContext.Provider>
  );
}

const FocusReturnTrigger = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Trigger>
>((props, ref) => {
  const hasTrigger = React.useContext(HasTriggerContext);
  React.useEffect(() => {
    if (!hasTrigger) return;
    hasTrigger.current = true;
    return () => {
      hasTrigger.current = false;
    };
  }, [hasTrigger]);
  return <DialogPrimitive.Trigger ref={ref} {...props} />;
});
FocusReturnTrigger.displayName = DialogPrimitive.Trigger.displayName;

/**
 * El `Content` de Radix, que además recuerda quién tenía el foco al abrirse.
 * Va SIEMPRE dentro del `Portal`: este solo monta a sus hijos mientras el panel
 * está abierto, así que el montaje es el momento de abrir aunque el panel lleve
 * montado con `open={false}` desde el principio, y cada apertura apunta de nuevo.
 */
const FocusReturnContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ onCloseAutoFocus, ...props }, ref) => {
  const hasTrigger = React.useContext(HasTriggerContext);
  // Durante el render el foco sigue en quien abrió: Radix lo mete en el panel
  // después, en un efecto.
  const [opener] = React.useState(() =>
    typeof document === "undefined" ? null : document.activeElement,
  );
  return (
    <DialogPrimitive.Content
      ref={ref}
      {...props}
      onCloseAutoFocus={(event) => {
        onCloseAutoFocus?.(event);
        // Quien usa el panel ya decidió, o hay trigger y lo enfoca Radix.
        if (event.defaultPrevented || hasTrigger?.current) return;
        // Sin nadie a quien volver (se abrió solo, o quien abrió ya no está en
        // la página) se deja como estaba.
        if (!(opener instanceof HTMLElement) || opener === document.body || !opener.isConnected) {
          return;
        }
        event.preventDefault();
        opener.focus();
      }}
    />
  );
});
FocusReturnContent.displayName = DialogPrimitive.Content.displayName;

export { FocusReturnRoot, FocusReturnTrigger, FocusReturnContent };
