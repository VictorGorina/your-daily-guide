import { useLayoutEffect, useRef } from "react";

/**
 * El último valor de algo que cambia en cada render, para leerlo desde un
 * efecto SIN que sea una de sus dependencias: el efecto se dispara por lo que
 * declara y, al correr, lee aquí el valor del render que lo disparó.
 *
 * Es lo que hace `useEffectEvent` de React 19.2 (el que usa la app móvil); aquí
 * va a mano porque el `eslint-plugin-react-hooks` de la web (5.x) aún no lo
 * conoce y marcaría el evento como dependencia que falta. `useLayoutEffect`
 * corre antes que cualquier `useEffect` del mismo commit.
 */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
