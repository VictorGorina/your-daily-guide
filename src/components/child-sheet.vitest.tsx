import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { HouseholdChild } from "@/lib/household";
import i18next from "@/lib/i18n";
import { setFakeBrowser } from "@/test/browser-client";
import { createFakeSupabase } from "@/test/fake-supabase";
import { renderApp } from "@/test/render";

import { ChildSheet } from "./child-sheet";

const t = i18next.t.bind(i18next);
const HOME = "hogar-1";

const vera: HouseholdChild = {
  id: "peque-1",
  name: "Vera",
  age: 6,
  allergies: null,
  appetite: "normal",
  notes: null,
  feeding_stage: "mesa",
  portion: 0.6,
  home_schedule: null,
};

/** La hoja escribe con las funciones de verdad de `@/lib/household` sobre el doble. */
function setup(child: HouseholdChild | null) {
  const fake = createFakeSupabase({
    household_children: child ? [{ ...child, household_id: HOME }] : [],
  });
  setFakeBrowser(fake.client);
  const onClose = vi.fn();
  const onChanged = vi.fn();
  const { queryClient } = renderApp(
    <ChildSheet open child={child} householdId={HOME} onClose={onClose} onChanged={onChanged} />,
  );
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const writes = () => fake.calls.filter((c) => c.op !== "select");
  return { user: userEvent.setup(), fake, writes, onClose, onChanged, invalidate };
}

const save = () => screen.getByRole("button", { name: t("common.save") });

describe("ChildSheet", () => {
  it("no deja guardar un peque sin nombre", () => {
    setup(null);
    expect(save()).toBeDisabled();
  });

  it("da de alta un peque en la casa, con su ración calculada", async () => {
    const { user, fake, writes, onClose, onChanged, invalidate } = setup(null);
    await user.type(screen.getByRole("textbox", { name: t("childSheet.name") }), "Leo");
    await user.type(screen.getByRole("textbox", { name: t("childSheet.age") }), "4");
    await user.click(save());

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toMatchObject({ table: "household_children", op: "insert" });
    expect(fake.tables.household_children[0]).toMatchObject({
      household_id: HOME,
      name: "Leo",
      age: 4,
      feeding_stage: "mesa",
      appetite: "normal",
    });
    expect(fake.tables.household_children[0].portion).toBeGreaterThan(0);
    // La mesa cambió: se relee el hogar y se avisa para el recálculo del plan.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["household"] });
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("un bebé de pecho no cuenta raciones y no se pregunta por su apetito", async () => {
    const { user, fake, onClose } = setup(null);
    await user.type(screen.getByRole("textbox", { name: t("childSheet.name") }), "Noa");
    await user.click(screen.getByRole("button", { name: t("feedingStage.pecho") }));
    expect(screen.queryByText(t("childSheet.appetite"))).not.toBeInTheDocument();
    await user.click(save());

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(fake.tables.household_children[0]).toMatchObject({
      name: "Noa",
      feeding_stage: "pecho",
      portion: 0,
    });
  });

  it("edita el peque que se le pasa, sin crear otro", async () => {
    const { user, fake, writes, onClose } = setup(vera);
    const allergies = screen.getByRole("textbox", { name: t("childSheet.allergies") });
    await user.type(allergies, "huevo");
    await user.click(save());

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(writes().map((c) => c.op)).toEqual(["update"]);
    expect(fake.tables.household_children).toHaveLength(1);
    expect(fake.tables.household_children[0]).toMatchObject({ id: "peque-1", allergies: "huevo" });
  });

  it("quitar un peque pide confirmación antes de borrar", async () => {
    const { user, fake, writes, onClose, onChanged } = setup(vera);
    await user.click(screen.getByRole("button", { name: t("childSheet.remove") }));
    expect(writes()).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: t("childSheet.removeConfirm") }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(fake.tables.household_children).toHaveLength(0);
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("si el guardado falla, la hoja sigue abierta y no avisa del cambio", async () => {
    const fake = createFakeSupabase({}, { failOn: (op) => op.op === "insert" });
    setFakeBrowser(fake.client);
    const onClose = vi.fn();
    const onChanged = vi.fn();
    renderApp(
      <ChildSheet open child={null} householdId={HOME} onClose={onClose} onChanged={onChanged} />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: t("childSheet.name") }), "Leo");
    await user.click(save());

    await waitFor(() => expect(save()).toBeEnabled());
    expect(onClose).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });
});
