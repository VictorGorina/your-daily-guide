import { describe, expect, it } from "bun:test";

import { INVITE_CODE_TTL_DAYS, inviteCodeExpiresAt, isInviteCodeExpired } from "./household-invite";

describe("inviteCodeExpiresAt", () => {
  it("caduca 30 días después de generarse, como en SQL", () => {
    expect(INVITE_CODE_TTL_DAYS).toBe(30);
    expect(inviteCodeExpiresAt("2026-10-24T10:00:00Z")?.toISOString()).toBe(
      "2026-11-23T10:00:00.000Z",
    );
  });

  it("sin fecha, o con una rota, no inventa una", () => {
    expect(inviteCodeExpiresAt(null)).toBeNull();
    expect(inviteCodeExpiresAt(undefined)).toBeNull();
    expect(inviteCodeExpiresAt("no es una fecha")).toBeNull();
  });
});

describe("isInviteCodeExpired", () => {
  const created = "2026-10-24T10:00:00Z";

  it("vale hasta el último instante y deja de valer justo a los 30 días", () => {
    expect(isInviteCodeExpired(created, new Date("2026-11-23T09:59:59Z"))).toBe(false);
    expect(isInviteCodeExpired(created, new Date("2026-11-23T10:00:00Z"))).toBe(true);
  });

  it("sin fecha se da por vigente: lo decide el servidor", () => {
    expect(isInviteCodeExpired(null, new Date("2030-01-01T00:00:00Z"))).toBe(false);
  });
});
