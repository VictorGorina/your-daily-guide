import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  HEALTH_CONSENT_VERSION,
  HEALTH_PROFILE_FIELDS,
  hasHealthData,
  healthConsentPatch,
  healthWithdrawalPatch,
  needsHealthConsent,
  withoutHealthData,
} from "./health-consent";

describe("needsHealthConsent", () => {
  test("solo a quien guarda datos de salud sin consentimiento", () => {
    expect(needsHealthConsent({ medications: "metformina" })).toBe(true);
    expect(needsHealthConsent({ medications: "metformina", ...healthConsentPatch() })).toBe(false);
    expect(needsHealthConsent({ medications: null, smoking: "  " })).toBe(false);
    expect(needsHealthConsent(null)).toBe(false);
  });

  test("y otra vez si aceptó un texto anterior", () => {
    expect(
      needsHealthConsent({
        ed_history: "pasada",
        health_consent_at: "2026-10-24T10:00:00Z",
        health_consent_version: "2026-01",
      }),
    ).toBe(true);
  });
});

describe("parches", () => {
  test("retirarlo vacía cada dato de salud y el consentimiento", () => {
    const patch = healthWithdrawalPatch();
    expect(Object.keys(patch).sort()).toEqual(
      [...HEALTH_PROFILE_FIELDS, "health_consent_at", "health_consent_version"].sort(),
    );
    expect(Object.values(patch).every((v) => v === null)).toBe(true);
    expect(hasHealthData(patch)).toBe(false);
  });

  test("aceptar guarda la versión del texto", () => {
    expect(healthConsentPatch(new Date("2026-10-24T08:00:00Z"))).toEqual({
      health_consent_at: "2026-10-24T08:00:00.000Z",
      health_consent_version: HEALTH_CONSENT_VERSION,
    });
  });

  test("sin consentimiento, el parche pierde los datos de salud y conserva lo demás", () => {
    expect(
      withoutHealthData({ display_name: "Ana", pregnancy_status: "embarazada", alcohol: null }),
    ).toEqual({ display_name: "Ana" });
  });
});

describe("la guarda de la base de datos", () => {
  const path = fileURLToPath(
    new URL("../../supabase/migrations/20261024170100_health_consent_guard.sql", import.meta.url),
  );

  test("nombra cada dato de salud al comprobarlo y al borrarlo", () => {
    const sql = readFileSync(path, "utf8");
    for (const field of HEALTH_PROFILE_FIELDS) {
      expect(sql).toContain(`NEW.${field} := NULL`);
      expect(sql).toContain(`NEW.${field} IS NOT NULL`);
      expect(sql).toContain(`NEW.${field} IS DISTINCT FROM OLD.${field}`);
    }
  });
});
