import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

// Smoke de punta a punta (ticket 25 de la auditoría): Ana, la persona del
// seed, entra y recorre Hoy, Plan y Familia contra el Supabase local. Es UN
// recorrido, no una batería: comprueba que el build de producción arranca, que
// la sesión llega al servidor, que las políticas RLS dejan leer y escribir lo
// propio y que la IA (aquí de mentira) calcula los platos.

const es = JSON.parse(readFileSync(new URL("../src/locales/es.json", import.meta.url), "utf8")) as {
  auth: { emailLabel: string; passwordPlaceholder: string; signIn: string };
  hoy: { meals: { ateThisLabel: string; undoLabel: string; calculating: string } };
  macros: { eatenToday: string };
  planCalendar: { title: string };
  moments: { Comida: string };
};

/** Las comidas del plan de Ana (`lunches` de supabase/seed.sql). */
const SEED_LUNCH =
  /Lentejas estofadas|Pollo al horno|Arroz con verduras|Merluza a la plancha|Garbanzos con espinacas|Pasta integral|Ternera salteada/;

const label = (template: string) => template.replace("{{meal}}", es.moments.Comida);

/** «~N kcal de lo que llevas comido hoy» con N > 0: la comida marcada tiene su cifra. */
const EATEN_KCAL = new RegExp(es.macros.eatenToday.replace("{{kcal}}", "[1-9]\\d*"));

test("Ana entra, marca la comida y ve su plan y su familia", async ({ page, request }) => {
  await page.goto("/auth");
  await page.getByLabel(es.auth.emailLabel).fill("ana@peppers.test");
  await page.getByLabel(es.auth.passwordPlaceholder).fill("peppers-local-1");
  await page.getByRole("button", { name: es.auth.signIn, exact: true }).click();

  // Hoy: la tira de comidas sale del plan del mes.
  await page.waitForURL("**/hoy");
  const ate = page.getByRole("button", { name: label(es.hoy.meals.ateThisLabel) });
  const undo = page.getByRole("button", { name: label(es.hoy.meals.undoLabel) });
  await expect(ate.or(undo)).toBeVisible();
  // Un reintento encuentra la comida ya marcada por el intento anterior.
  if (await undo.isVisible()) await undo.click();
  await expect(ate).toBeVisible();
  await expect(page.getByText(SEED_LUNCH).first()).toBeVisible();

  // Los platos se calculan con su receta, que aquí da el OpenRouter de mentira.
  await expect
    .poll(
      async () => (await (await request.get("http://127.0.0.1:4010/requests")).json()).recipes,
      {
        timeout: 30_000,
      },
    )
    .toBeGreaterThan(0);
  await expect(page.getByText(es.hoy.meals.calculating)).toHaveCount(0, { timeout: 30_000 });

  // Marcar la comida se guarda: sigue marcada al recargar.
  const saved = page.waitForResponse(
    (res) =>
      res.url().includes("/rest/v1/daily_logs") && res.request().method() !== "GET" && res.ok(),
  );
  await ate.click();
  await expect(undo).toBeVisible();
  await saved;
  // Y suma en la barra del día, que solo cuenta platos ya calculados. Que no
  // se vea «Calculando…» no basta: tampoco se ve mientras la guía no ha llegado.
  await expect(page.getByText(EATEN_KCAL)).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(undo).toBeVisible();
  await expect(page.getByText(EATEN_KCAL)).toBeVisible({ timeout: 30_000 });

  // Plan: el calendario del mes, con sus días.
  // Por la dirección y no por el nombre: en la última semana del mes el enlace
  // lleva además el punto de «toca preparar tu plan».
  await page.locator('a[href="/plan"]').click();
  await page.waitForURL("**/plan");
  await expect(page.getByText(es.planCalendar.title)).toBeVisible();
  // Un día pasado se llama «Ver el día N» y uno futuro solo lleva su número:
  // el 28 existe en cualquier mes, sea lo uno o lo otro.
  await expect(page.getByRole("button", { name: /^(Ver el día )?28(:|$)/ })).toBeVisible();

  // Familia: el hueco sin cuenta (Leo) y la peque (Vera).
  await page.locator('a[href="/hogar"]').click();
  await page.waitForURL("**/hogar");
  // Quien planifica ve el nombre de los demás en un campo, para cambiarlo.
  await expect(page.locator('input[value="Leo"]')).toBeVisible();
  await expect(page.getByText("Vera", { exact: true }).first()).toBeVisible();
});
