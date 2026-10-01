import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import { fetchProfile } from "./daily";
import { currencySymbol, formatMoney } from "./plan-shared";

/**
 * Formateador de precios en la moneda del perfil (ticket 34, I18N-02). Lee el
 * perfil de la caché de React Query, que las pantallas con precios ya tienen
 * cargado. Sin perfil todavía, euros (como antes).
 */
export function useMoney(): (amount: number) => string {
  const { data } = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const currency = data?.currency;
  return useCallback((amount: number) => formatMoney(amount, currency), [currency]);
}

/** Símbolo de la moneda del perfil, para poner junto a un campo de importe. */
export function useCurrencySymbol(): string {
  const { data } = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  return currencySymbol(data?.currency);
}
