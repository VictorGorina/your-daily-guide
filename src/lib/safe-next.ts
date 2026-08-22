/** Solo rutas internas del propio origen. Rechaza //host, /\host y URLs absolutas. */
export function safeInternalPath(raw: string | undefined): string | undefined {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\"))
    return undefined;
  try {
    const resolved = new URL(raw, window.location.origin);
    return resolved.origin === window.location.origin
      ? resolved.pathname + resolved.search
      : undefined;
  } catch {
    return undefined;
  }
}
