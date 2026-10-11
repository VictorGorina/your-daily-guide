import { describe, expect, it } from "bun:test";

import type { DbClient } from "@/integrations/supabase/db-client";
import { createFakeSupabase } from "@/test/fake-supabase";
import { ValidationError } from "@/lib/validation-error";

import { generateOrExisting, plannedMonthsOf } from "./job-runners.server";

const fails = async (): Promise<{ firstPlan: boolean }> => {
  throw new ValidationError("Noviembre ya tiene su plan.");
};

describe("generateOrExisting", () => {
  it("si genera, devuelve solo firstPlan (ni el plan ni la compra)", async () => {
    const run = async () => ({ firstPlan: true, plan: { weeks: [] }, shopping: [] });
    expect(await generateOrExisting(run, async () => [], "2026-11")).toEqual({ firstPlan: true });
  });

  it("un relevo que encuentra el plan ya guardado termina bien", async () => {
    expect(await generateOrExisting(fails, async () => ["2026-11"], "2026-11")).toEqual({
      firstPlan: true,
    });
  });

  it("con planes de otros meses, ese no es el primero", async () => {
    const months = async () => ["2026-10", "2026-11"];
    expect(await generateOrExisting(fails, months, "2026-11")).toEqual({ firstPlan: false });
  });

  it("si el mes sigue sin plan, el error es el del trabajo", async () => {
    await expect(generateOrExisting(fails, async () => ["2026-10"], "2026-11")).rejects.toThrow(
      "ya tiene su plan",
    );
  });

  it("si tampoco se puede mirar, el error es el del trabajo, no el de la lectura", async () => {
    const broken = async (): Promise<string[]> => {
      throw new Error("timeout");
    };
    const quota = async (): Promise<{ firstPlan: boolean }> => {
      throw new Error("sin cuota");
    };
    await expect(generateOrExisting(quota, broken, "2026-11")).rejects.toThrow("sin cuota");
  });
});

describe("plannedMonthsOf", () => {
  it("solo cuenta la fila propia, aunque el cliente no tenga RLS", async () => {
    const fake = createFakeSupabase({
      monthly_plans: [
        { id: "1", user_id: "ana", month: "2026-10" },
        { id: "2", user_id: "ana", month: "2026-11" },
        { id: "3", user_id: "bea", month: "2026-12" },
      ],
    });
    const months = await plannedMonthsOf(fake.client as unknown as DbClient, "ana");
    expect(months.sort()).toEqual(["2026-10", "2026-11"]);
  });
});
