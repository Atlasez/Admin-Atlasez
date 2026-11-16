import { pathToFileURL } from "node:url";

const clone = (state) => structuredClone(state);
const sameState = (left, right) =>
  JSON.stringify(left) === JSON.stringify(right);

export const initialPublicationState = () => ({
  documentVersion: 1,
  documentState: "draft",
  approvedVersion: null,
  publishedVersion: null,
  run: null,
  idempotencyKeys: [],
});

/**
 * Bounded model of the worker's editorial publication transition.
 * The `complete` transition represents the updated_at compare-and-set in
 * progressEditorialPublicationRun; a stale version moves to needs_operator.
 */
export function transitionPublication(state, action) {
  const next = clone(state);
  let idempotentReplay = false;

  switch (action.type) {
    case "edit":
      if (next.documentState !== "published" && next.documentVersion < 3) {
        next.documentVersion += 1;
        next.documentState = "draft";
        next.approvedVersion = null;
      }
      break;
    case "approve":
      if (next.documentState !== "published") {
        next.documentState = "approved";
        next.approvedVersion = next.documentVersion;
      }
      break;
    case "request":
      if (next.idempotencyKeys.includes(action.key)) {
        idempotentReplay = true;
        break;
      }
      if (
        next.documentState === "approved" &&
        next.run?.state !== "pending" &&
        next.run?.state !== "published"
      ) {
        next.idempotencyKeys.push(action.key);
        next.run = {
          key: action.key,
          expectedVersion: next.documentVersion,
          state: "pending",
        };
      }
      break;
    case "retry":
      if (next.run?.key === action.key) idempotentReplay = true;
      break;
    case "complete":
      if (next.run?.state === "pending") {
        if (
          next.run.expectedVersion === next.documentVersion &&
          next.approvedVersion === next.documentVersion
        ) {
          next.documentState = "published";
          next.publishedVersion = next.documentVersion;
          next.run.state = "published";
        } else {
          next.run.state = "needs_operator";
        }
      }
      break;
    case "cancel":
      if (next.run?.state === "pending") next.run.state = "cancelled";
      break;
    default:
      throw new Error("Unknown publication action: " + action.type);
  }

  return { state: next, changed: !sameState(state, next), idempotentReplay };
}

export function publicationInvariantViolations(state) {
  const violations = [];
  if (new Set(state.idempotencyKeys).size !== state.idempotencyKeys.length)
    violations.push("idempotency keys are unique");
  if (state.run && !state.idempotencyKeys.includes(state.run.key))
    violations.push("run key was recorded exactly once");
  if (state.run?.state === "needs_operator" && state.publishedVersion !== null)
    violations.push("compare-and-set conflict cannot publish");
  if (state.run?.state === "published") {
    if (state.publishedVersion !== state.run.expectedVersion)
      violations.push("published run matches its captured version");
    if (state.approvedVersion !== state.publishedVersion)
      violations.push("published version was approved");
    if (state.documentVersion !== state.publishedVersion)
      violations.push("newer edits cannot be overwritten");
  }
  if (
    state.publishedVersion !== null &&
    (state.documentState !== "published" ||
      state.approvedVersion !== state.publishedVersion ||
      state.documentVersion !== state.publishedVersion)
  )
    violations.push("only the current approved version can be public");
  return violations;
}

export function explorePublicationModel(maxDepth = 10) {
  const queue = [{ state: initialPublicationState(), path: [], depth: 0 }];
  const visited = new Set();
  const actions = [
    { type: "edit" },
    { type: "approve" },
    { type: "request", key: "key-1" },
    { type: "request", key: "key-2" },
    { type: "retry", key: "key-1" },
    { type: "retry", key: "key-2" },
    { type: "complete" },
    { type: "cancel" },
  ];
  const coverage = {
    published: false,
    compareAndSetConflict: false,
    cancelled: false,
    idempotentReplay: false,
  };
  let transitions = 0;

  while (queue.length) {
    const current = queue.shift();
    const key = JSON.stringify(current.state);
    if (visited.has(key)) continue;
    visited.add(key);

    const violations = publicationInvariantViolations(current.state);
    if (violations.length)
      return {
        ok: false,
        states: visited.size,
        transitions,
        coverage,
        counterexample: {
          path: current.path,
          violations,
          state: current.state,
        },
      };

    coverage.published ||= current.state.run?.state === "published";
    coverage.compareAndSetConflict ||=
      current.state.run?.state === "needs_operator";
    coverage.cancelled ||= current.state.run?.state === "cancelled";

    if (current.depth >= maxDepth) continue;
    for (const action of actions) {
      const result = transitionPublication(current.state, action);
      transitions += 1;
      coverage.idempotentReplay ||= result.idempotentReplay;
      const nextKey = JSON.stringify(result.state);
      if (result.changed && !visited.has(nextKey))
        queue.push({
          state: result.state,
          path: [...current.path, action],
          depth: current.depth + 1,
        });
    }
  }

  return {
    ok: Object.values(coverage).every(Boolean),
    states: visited.size,
    transitions,
    coverage,
    counterexample: null,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const result = explorePublicationModel();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
