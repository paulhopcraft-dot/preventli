import { describe, it, expect } from "vitest";
import {
  CHECK_CATEGORIES,
  CHECK_LABELS,
  assessmentTypesForCategory,
} from "./check-categories";

describe("assessmentTypesForCategory", () => {
  it("maps pre_employment to the six clinical assessment types", () => {
    expect(assessmentTypesForCategory("pre_employment")).toEqual([
      "baseline_health",
      "functional_capacity",
      "medical_screening",
      "fitness_for_duty",
      "psychological_assessment",
      "substance_screening",
    ]);
  });

  it("maps prevention to [prevention]", () => {
    expect(assessmentTypesForCategory("prevention")).toEqual(["prevention"]);
  });

  it("maps injury to [injury]", () => {
    expect(assessmentTypesForCategory("injury")).toEqual(["injury"]);
  });

  it("maps wellness to [wellness]", () => {
    expect(assessmentTypesForCategory("wellness")).toEqual(["wellness"]);
  });

  it("maps mental_health to [mental_health]", () => {
    expect(assessmentTypesForCategory("mental_health")).toEqual(["mental_health"]);
  });

  it("maps exit to [exit]", () => {
    expect(assessmentTypesForCategory("exit")).toEqual(["exit"]);
  });

  it("returns a fresh array each call (caller cannot mutate internal state)", () => {
    const first = assessmentTypesForCategory("pre_employment");
    first.push("tampered");
    expect(assessmentTypesForCategory("pre_employment")).not.toContain("tampered");
  });
});

describe("CHECK_CATEGORIES", () => {
  it("contains exactly the six known categories", () => {
    expect([...CHECK_CATEGORIES].sort()).toEqual([
      "exit",
      "injury",
      "mental_health",
      "pre_employment",
      "prevention",
      "wellness",
    ]);
  });

  it("has a display label for every category", () => {
    for (const category of CHECK_CATEGORIES) {
      expect(typeof CHECK_LABELS[category]).toBe("string");
      expect(CHECK_LABELS[category].length).toBeGreaterThan(0);
    }
  });
});
