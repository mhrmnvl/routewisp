import { describe, it, expect } from "vitest";
import { buildQuotaV1Entries, quotaPercentRemaining } from "@/lib/quotaV1.js";

describe("quota-v1 adapter", () => {
  it("maps remainingPercentage quotas to percent entries", () => {
    const entries = buildQuotaV1Entries([{
      connection: { provider: "antigravity", email: "a@b.c" },
      usage: {
        quotas: {
          "gemini-3.8-flash-low": {
            displayName: "Gemini 3.8 Flash (Low)",
            used: 14,
            total: 1000,
            remainingPercentage: 98.64417,
            resetAt: "2026-09-21T06:19:41.000Z",
          },
        },
      },
    }]);

    expect(entries).toEqual([{
      kind: "percent",
      resultType: "quota",
      name: "a@b.c Gemini 3.8 Flash (Low)",
      label: "antigravity",
      percentRemaining: 98.64417,
      resetTimeIso: "2026-09-21T06:19:41.000Z",
      right: "14/1000",
    }]);
  });

  it("derives percent from remaining/total and emits used/total", () => {
    const entries = buildQuotaV1Entries([{
      connection: { provider: "commandcode", name: "commandcode" },
      usage: {
        quotas: {
          Credits: { used: 6.16, total: 10, remaining: 3.84, resetAt: "2026-10-14T01:44:25.000Z" },
        },
      },
    }]);

    expect(entries[0].percentRemaining).toBeCloseTo(38.4, 5);
    expect(entries[0].right).toBe("6.16/10");
    expect(entries[0].resetTimeIso).toBe("2026-10-14T01:44:25.000Z");
  });

  it("skips quotas without a usable number and clamps to 100", () => {
    expect(buildQuotaV1Entries([
      { connection: { provider: "x" }, usage: { quotas: { foo: { unlimited: true } } } },
      { connection: { provider: "x" }, usage: null },
    ])).toEqual([]);

    const [over] = buildQuotaV1Entries([
      { connection: { provider: "x" }, usage: { quotas: { foo: { remainingPercentage: 150 } } } },
    ]);
    expect(over.percentRemaining).toBe(100);
  });

  it("quotaPercentRemaining returns undefined for unusable limits", () => {
    expect(quotaPercentRemaining({ total: 0, remaining: 1 })).toBeUndefined();
    expect(quotaPercentRemaining(undefined)).toBeUndefined();
  });
});
