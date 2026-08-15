// Service worker mínimo: solo push notifications, sin caché ni offline.
// Registrado desde src/routes/__root.tsx.

self.addEventListener("push", (event) => {
  let data = { title: "Daily Guide", body: "", url: "/hoy" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // payload no-JSON: se queda el título/cuerpo por defecto.
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      data: { url: data.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/hoy";

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const existing = clientsList.find((c) => new URL(c.url).pathname === url);
      if (existing) {
        await existing.focus();
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
