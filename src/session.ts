import { advanceToRetry, enqueue, maxRunSteps, processNext, scenarios } from "./queue.js";
import type { Queue, Scenario } from "./queue.js";

export const sessionKey = "webhook-lab-run-v1";
export type Step = Scenario | "process" | "advance";
type SessionStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Run = { queue: Queue; steps: Step[]; selectedId?: number };

function decode(raw: string): Run | undefined {
  if (raw.length > 4_096) return;
  let saved;
  try {
    saved = JSON.parse(raw);
  } catch {
    return;
  }
  if (!Array.isArray(saved?.steps) || saved.steps.length > maxRunSteps) return;
  const queue: Queue = { now: 0, attemptCount: 0, deliveries: [] };
  for (const step of saved.steps) {
    if (step === "process") {
      if (!processNext(queue)) return;
    } else if (step === "advance") {
      if (advanceToRetry(queue) === null) return;
    } else if (typeof step === "string" && Object.hasOwn(scenarios, step)) {
      if (enqueue(queue, queue.deliveries.length + 1, step as Scenario) !== "queued") return;
    } else {
      return;
    }
  }
  if (!queue.deliveries.some(delivery => delivery.id === saved.selectedId)) return;
  return { queue, steps: saved.steps, selectedId: saved.selectedId };
}

export function clearRun(storage?: SessionStore) {
  if (!storage) return false;
  try {
    storage.removeItem(sessionKey);
    return true;
  } catch {
    return false;
  }
}

export function loadRun(storage?: SessionStore) {
  const empty: Run = { queue: { now: 0, attemptCount: 0, deliveries: [] }, steps: [] };
  if (!storage) return { ...empty, status: "unavailable" };
  let raw;
  try {
    raw = storage.getItem(sessionKey);
  } catch {
    return { ...empty, status: "unavailable" };
  }
  if (raw === null) return { ...empty, status: "fresh" };
  const restored = decode(raw);
  if (restored) return { ...restored, status: "restored" };
  return { ...empty, status: clearRun(storage) ? "discarded" : "unavailable" };
}

export function saveRun(storage: SessionStore | undefined, steps: Step[], selectedId: number) {
  if (!storage) return false;
  try {
    storage.setItem(sessionKey, JSON.stringify({ steps, selectedId }));
    return true;
  } catch {
    clearRun(storage);
    return false;
  }
}
