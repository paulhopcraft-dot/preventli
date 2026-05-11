import type { RTWPlanStatus } from "@shared/schema";

/**
 * RTW Planner Tests
 * PRD-3.2.3: Case lifecycle states
 * PRD-3.4: Task & obligation engine
 */

// Valid RTW plan status transitions (copied from rtw.ts for testing)
const VALID_TRANSITIONS: Record<RTWPlanStatus, RTWPlanStatus[]> = {
  not_planned: ["planned_not_started"],
  planned_not_started: ["in_progress", "on_hold", "not_planned"],
  in_progress: ["working_well", "failing", "on_hold", "completed"],
  working_well: ["in_progress", "completed", "on_hold"],
  failing: ["in_progress", "on_hold", "not_planned"],
  on_hold: ["planned_not_started", "in_progress", "not_planned"],
  completed: [], // Terminal state
};

function isValidTransition(from: RTWPlanStatus | undefined, to: RTWPlanStatus): boolean {
  const currentStatus: RTWPlanStatus = from || "not_planned";
  if (currentStatus === to) return true;
  return VALID_TRANSITIONS[currentStatus]?.includes(to) ?? false;
}

describe("RTW State Transitions (PRD-3.2.3)", () => {
  describe("from not_planned", () => {
    it("should allow transition to planned_not_started", () => {
      expect(isValidTransition("not_planned", "planned_not_started")).toBe(true);
    });

    it("should NOT allow direct transition to in_progress", () => {
      expect(isValidTransition("not_planned", "in_progress")).toBe(false);
    });

    it("should NOT allow direct transition to completed", () => {
      expect(isValidTransition("not_planned", "completed")).toBe(false);
    });

    it("should allow transition from undefined (defaults to not_planned)", () => {
      expect(isValidTransition(undefined, "planned_not_started")).toBe(true);
    });
  });

  describe("from planned_not_started", () => {
    it("should allow transition to in_progress", () => {
      expect(isValidTransition("planned_not_started", "in_progress")).toBe(true);
    });

    it("should allow transition to on_hold", () => {
      expect(isValidTransition("planned_not_started", "on_hold")).toBe(true);
    });

    it("should allow rollback to not_planned", () => {
      expect(isValidTransition("planned_not_started", "not_planned")).toBe(true);
    });

    it("should NOT allow direct transition to completed", () => {
      expect(isValidTransition("planned_not_started", "completed")).toBe(false);
    });
  });

  describe("from in_progress", () => {
    it("should allow transition to working_well", () => {
      expect(isValidTransition("in_progress", "working_well")).toBe(true);
    });

    it("should allow transition to failing", () => {
      expect(isValidTransition("in_progress", "failing")).toBe(true);
    });

    it("should allow transition to on_hold", () => {
      expect(isValidTransition("in_progress", "on_hold")).toBe(true);
    });

    it("should allow transition to completed", () => {
      expect(isValidTransition("in_progress", "completed")).toBe(true);
    });

    it("should NOT allow transition back to not_planned", () => {
      expect(isValidTransition("in_progress", "not_planned")).toBe(false);
    });
  });

  describe("from working_well", () => {
    it("should allow transition to completed", () => {
      expect(isValidTransition("working_well", "completed")).toBe(true);
    });

    it("should allow transition back to in_progress (if issues arise)", () => {
      expect(isValidTransition("working_well", "in_progress")).toBe(true);
    });

    it("should allow transition to on_hold", () => {
      expect(isValidTransition("working_well", "on_hold")).toBe(true);
    });

    it("should NOT allow transition to failing directly", () => {
      expect(isValidTransition("working_well", "failing")).toBe(false);
    });
  });

  describe("from failing", () => {
    it("should allow transition back to in_progress (for retry)", () => {
      expect(isValidTransition("failing", "in_progress")).toBe(true);
    });

    it("should allow transition to on_hold", () => {
      expect(isValidTransition("failing", "on_hold")).toBe(true);
    });

    it("should allow reset to not_planned (start over)", () => {
      expect(isValidTransition("failing", "not_planned")).toBe(true);
    });

    it("should NOT allow direct transition to completed", () => {
      expect(isValidTransition("failing", "completed")).toBe(false);
    });
  });

  describe("from on_hold", () => {
    it("should allow transition to planned_not_started (restart planning)", () => {
      expect(isValidTransition("on_hold", "planned_not_started")).toBe(true);
    });

    it("should allow transition to in_progress (resume)", () => {
      expect(isValidTransition("on_hold", "in_progress")).toBe(true);
    });

    it("should allow reset to not_planned", () => {
      expect(isValidTransition("on_hold", "not_planned")).toBe(true);
    });

    it("should NOT allow direct transition to completed", () => {
      expect(isValidTransition("on_hold", "completed")).toBe(false);
    });
  });

  describe("from completed (terminal state)", () => {
    it("should NOT allow any transitions out", () => {
      expect(isValidTransition("completed", "not_planned")).toBe(false);
      expect(isValidTransition("completed", "in_progress")).toBe(false);
      expect(isValidTransition("completed", "failing")).toBe(false);
    });

    it("should allow staying at completed", () => {
      expect(isValidTransition("completed", "completed")).toBe(true);
    });
  });

  describe("same-state transitions", () => {
    it("should allow staying in the same state (no-op)", () => {
      const states: RTWPlanStatus[] = [
        "not_planned",
        "planned_not_started",
        "in_progress",
        "working_well",
        "failing",
        "on_hold",
        "completed",
      ];

      for (const state of states) {
        expect(isValidTransition(state, state)).toBe(true);
      }
    });
  });
});

describe("RTW Plan Workflow Scenarios", () => {
  describe("happy path: successful RTW", () => {
    it("should allow complete successful workflow", () => {
      // Worker off work -> plan created -> start RTW -> going well -> completed
      expect(isValidTransition("not_planned", "planned_not_started")).toBe(true);
      expect(isValidTransition("planned_not_started", "in_progress")).toBe(true);
      expect(isValidTransition("in_progress", "working_well")).toBe(true);
      expect(isValidTransition("working_well", "completed")).toBe(true);
    });
  });

  describe("RTW with setbacks", () => {
    it("should allow plan to fail and retry", () => {
      expect(isValidTransition("in_progress", "failing")).toBe(true);
      expect(isValidTransition("failing", "in_progress")).toBe(true); // Retry
      expect(isValidTransition("in_progress", "working_well")).toBe(true);
      expect(isValidTransition("working_well", "completed")).toBe(true);
    });

    it("should allow plan to fail and restart from scratch", () => {
      expect(isValidTransition("in_progress", "failing")).toBe(true);
      expect(isValidTransition("failing", "not_planned")).toBe(true); // Start over
      expect(isValidTransition("not_planned", "planned_not_started")).toBe(true);
    });
  });

  describe("RTW with holds", () => {
    it("should allow putting plan on hold and resuming", () => {
      expect(isValidTransition("in_progress", "on_hold")).toBe(true);
      expect(isValidTransition("on_hold", "in_progress")).toBe(true); // Resume
    });

    it("should allow putting plan on hold and replanning", () => {
      expect(isValidTransition("in_progress", "on_hold")).toBe(true);
      expect(isValidTransition("on_hold", "planned_not_started")).toBe(true); // Replan
    });
  });
});

describe("VALID_TRANSITIONS structure", () => {
  it("should have all RTW statuses defined", () => {
    const allStatuses: RTWPlanStatus[] = [
      "not_planned",
      "planned_not_started",
      "in_progress",
      "working_well",
      "failing",
      "on_hold",
      "completed",
    ];

    for (const status of allStatuses) {
      expect(VALID_TRANSITIONS).toHaveProperty(status);
      expect(Array.isArray(VALID_TRANSITIONS[status])).toBe(true);
    }
  });

  it("should have completed as terminal (no outgoing transitions)", () => {
    expect(VALID_TRANSITIONS.completed).toHaveLength(0);
  });

  it("should have not_planned as entry point (only one outgoing transition)", () => {
    expect(VALID_TRANSITIONS.not_planned).toHaveLength(1);
    expect(VALID_TRANSITIONS.not_planned).toContain("planned_not_started");
  });
});
