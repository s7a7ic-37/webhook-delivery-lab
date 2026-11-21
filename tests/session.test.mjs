import assert from "node:assert/strict";
import test from "node:test";
import { clearRun, loadRun, saveRun, sessionKey } from "../dist/session.js";
import { capacity, maxRunSteps } from "../dist/queue.js";

function createStorage() {
  const data = new Map();
  return {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key),
  };
}

test("replay restores queue order, clock, selected event and attempt history", () => {
  const storage = createStorage();
  const steps = ["recover", "process", "success", "process", "advance", "process"];
  assert.equal(saveRun(storage, steps, 1), true);
  const saved = loadRun(storage);
  assert.equal(saved.status, "restored");
  assert.deepEqual(saved.steps, steps);
  assert.equal(saved.selectedId, 1);
  assert.deepEqual(saved.queue, {
    now: 2,
    attemptCount: 3,
    deliveries: [
      {
        id: 1, scenario: "recover", dueAt: 6,
        attempts: [
          { sequence: 1, at: 0, code: 503, retryAt: 2 },
          { sequence: 3, at: 2, code: 503, retryAt: 6 },
        ],
      },
      { id: 2, scenario: "success", dueAt: null, attempts: [{ sequence: 2, at: 0, code: 200, retryAt: null }] },
    ],
  });
});

test("a full valid run fits, and oversized, unknown or impossible steps are discarded", () => {
  const storage = createStorage();
  const event = ["exhaust", "process", "advance", "process", "advance", "process", "advance", "process"];
  const steps = Array.from({ length: capacity }, () => event).flat();
  assert.equal(steps.length, maxRunSteps);
  saveRun(storage, steps, capacity);
  assert.equal(loadRun(storage).queue.deliveries.length, capacity);

  for (const text of [
    "not JSON",
    " ".repeat(4_097),
    JSON.stringify({ steps: [...steps, "success"], selectedId: capacity + 1 }),
    JSON.stringify({ steps: ["__proto__"], selectedId: 1 }),
    JSON.stringify({ steps: ["success", "advance"], selectedId: 1 }),
    JSON.stringify({ steps: ["success", "process", "process"], selectedId: 1 }),
    JSON.stringify({ steps: ["success"], selectedId: 2 }),
  ]) {
    storage.setItem(sessionKey, text);
    assert.equal(loadRun(storage).status, "discarded");
    assert.equal(storage.getItem(sessionKey), null);
  }
});

test("reset clears only this app's saved run", () => {
  const storage = createStorage();
  storage.setItem("other-state", "keep");
  saveRun(storage, ["success"], 1);
  assert.equal(clearRun(storage), true);
  assert.equal(loadRun(storage).status, "fresh");
  assert.equal(storage.getItem("other-state"), "keep");
});

test("storage errors fall back to a fresh run and failed writes try to clear stale state", () => {
  const blocked = () => { throw new Error("Storage blocked"); };
  assert.equal(loadRun().status, "unavailable");
  assert.equal(loadRun({ getItem: blocked }).status, "unavailable");
  assert.equal(clearRun({ removeItem: blocked }), false);

  const storage = createStorage();
  saveRun(storage, ["success"], 1);
  assert.equal(saveRun({ ...storage, setItem: blocked }, ["success", "process"], 1), false);
  assert.equal(storage.getItem(sessionKey), null);
});
