import { describe, expect, it } from "vitest";
import {
  explorePublicationModel,
  initialPublicationState,
  transitionPublication,
} from "../../scripts/verify-publication-model.mjs";

describe("bounded editorial publication model", () => {
  it("checks publication, compare-and-set, cancellation, and retry invariants", () => {
    const result = explorePublicationModel(10);
    expect(result.ok, JSON.stringify(result.counterexample)).toBe(true);
    expect(result.states).toBeGreaterThan(10);
    expect(result.transitions).toBeGreaterThan(result.states);
    expect(result.coverage).toEqual({
      published: true,
      compareAndSetConflict: true,
      cancelled: true,
      idempotentReplay: true,
    });
  });

  it("repeating a publish key returns the same pending run", () => {
    let state = initialPublicationState();
    state = transitionPublication(state, { type: "approve" }).state;
    const first = transitionPublication(state, {
      type: "request",
      key: "same",
    });
    const retry = transitionPublication(first.state, {
      type: "request",
      key: "same",
    });

    expect(first.state.run?.key).toBe("same");
    expect(first.state.idempotencyKeys).toEqual(["same"]);
    expect(retry.changed).toBe(false);
    expect(retry.idempotentReplay).toBe(true);
  });
});
