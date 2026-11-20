import { describe, expect, it } from "vitest";
import { computeSla } from "../src/lib/sla.js";
import { businessDaysBetween, calendarDaysBetween } from "../src/lib/dates.js";

const targets = [
  { key: "INSPECTION", label: "Inspection", targetDays: 2, businessDays: true },
  { key: "PRELIM_REPORT", label: "Prelim", targetDays: 7, businessDays: false },
  { key: "FINAL_REPORT", label: "Final", targetDays: 14, businessDays: false },
  { key: "SIGNOFF", label: "Sign-off", targetDays: 3, businessDays: true },
];
const t = (iso: string) => new Date(iso);

describe("dates", () => {
  it("counts working days, skipping weekends", () => {
    // Fri 2026-11-13 -> Tue 2026-11-17: Mon, Tue = 2
    expect(businessDaysBetween(t("2026-11-13T09:00:00Z"), t("2026-11-17T09:00:00Z"))).toBe(2);
    expect(businessDaysBetween(t("2026-11-17T09:00:00Z"), t("2026-11-13T09:00:00Z"))).toBe(0);
    expect(calendarDaysBetween(t("2026-11-13T09:00:00Z"), t("2026-11-17T09:00:00Z"))).toBe(4);
  });
  it("uses Lagos dates (UTC+1)", () => {
    // 23:30 UTC is already the next day in Lagos.
    expect(calendarDaysBetween(t("2026-11-13T12:00:00Z"), t("2026-11-13T23:30:00Z"))).toBe(1);
  });
});

describe("computeSla", () => {
  const instructed = t("2026-11-02T00:00:00Z"); // Monday

  it("marks met, missed, breached and at-risk clocks", () => {
    const clocks = computeSla(
      {
        dateInstructed: instructed,
        status: "AWAITING_DOCUMENTS",
        history: [
          { fromStatus: null, toStatus: "NEW_INSTRUCTION", changedAt: t("2026-11-02T08:00:00Z") },
          { fromStatus: "NEW_INSTRUCTION", toStatus: "INSPECTION_SCHEDULED", changedAt: t("2026-11-02T10:00:00Z") },
          { fromStatus: "INSPECTION_SCHEDULED", toStatus: "UNDER_INVESTIGATION", changedAt: t("2026-11-05T10:00:00Z") },
          { fromStatus: "UNDER_INVESTIGATION", toStatus: "PRELIM_REPORT_SUBMITTED", changedAt: t("2026-11-12T10:00:00Z") },
          { fromStatus: "PRELIM_REPORT_SUBMITTED", toStatus: "AWAITING_DOCUMENTS", changedAt: t("2026-11-12T11:00:00Z") },
        ],
        inspections: [{ completedDate: t("2026-11-04T10:00:00Z") }],
      },
      targets,
      t("2026-11-20T12:00:00Z"),
    );
    const by = Object.fromEntries(clocks.map((c) => [c.key, c]));
    expect(by.INSPECTION).toMatchObject({ state: "MET", elapsedDays: 2 });
    expect(by.PRELIM_REPORT).toMatchObject({ state: "MISSED", elapsedDays: 10 });
    expect(by.FINAL_REPORT!.state).toBe("NOT_STARTED");
    expect(by.SIGNOFF!.state).toBe("NOT_STARTED");
  });

  it("flags open clocks as at risk from 80% and breached after the target", () => {
    const base = { dateInstructed: instructed, status: "INSPECTION_SCHEDULED" as const, history: [], inspections: [] };
    const at = (iso: string) => computeSla(base, targets, t(iso)).find((c) => c.key === "INSPECTION")!.state;
    expect(at("2026-11-02T12:00:00Z")).toBe("ON_TRACK"); // 0 working days
    expect(at("2026-11-04T12:00:00Z")).toBe("AT_RISK"); // 2 of 2
    expect(at("2026-11-05T12:00:00Z")).toBe("BREACHED"); // 3 of 2
  });

  it("times the final report from documents complete and sign-off until the claim leaves it", () => {
    const clocks = computeSla(
      {
        dateInstructed: instructed,
        status: "SETTLED",
        history: [
          { fromStatus: "AWAITING_DOCUMENTS", toStatus: "FINAL_REPORT_DRAFTED", changedAt: t("2026-11-10T10:00:00Z") },
          { fromStatus: "FINAL_REPORT_DRAFTED", toStatus: "PENDING_SIGNOFF", changedAt: t("2026-11-20T10:00:00Z") },
          { fromStatus: "PENDING_SIGNOFF", toStatus: "SETTLED", changedAt: t("2026-11-24T10:00:00Z") },
        ],
        inspections: [],
      },
      targets,
      t("2026-11-30T12:00:00Z"),
    );
    const by = Object.fromEntries(clocks.map((c) => [c.key, c]));
    expect(by.FINAL_REPORT).toMatchObject({ state: "MET", elapsedDays: 10 });
    expect(by.SIGNOFF).toMatchObject({ state: "MET", elapsedDays: 2 }); // Fri -> Tue
    // A closed claim never inspected: not applicable rather than breached.
    expect(by.INSPECTION!.state).toBe("NOT_APPLICABLE");
  });
});
