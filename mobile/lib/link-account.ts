import { Alert } from "react-native";

import { linkForAnotherAccount } from "./link-claims";
import { supabase } from "./supabase";
import type { Translate } from "./week-nav";

/**
 * Antes de instalar la sesión de un enlace (confirmar la cuenta, restablecer la
 * contraseña): si ya hay otra cuenta abierta en este móvil, se pregunta. Sin
 * esto, abrir un enlace ajeno —reenviado, o de otra cuenta propia— cambiaba de
 * cuenta sin avisar (ticket 38, MOB-01). Devuelve si se puede seguir.
 */
export async function mayUseLinkSession(accessToken: string, t: Translate): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  const other = linkForAnotherAccount(accessToken, data.session?.user.id);
  if (!other) return true;
  return new Promise((resolve) => {
    Alert.alert(
      t("auth.otherAccount.title"),
      other.email
        ? t("auth.otherAccount.body", { email: other.email })
        : t("auth.otherAccount.bodyNoEmail"),
      [
        { text: t("auth.otherAccount.keep"), style: "cancel", onPress: () => resolve(false) },
        { text: t("auth.otherAccount.switch"), onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
