export const scenarios = {
  success: { label: "Immediate success", codes: [200] },
  recover: { label: "Temporary outage", codes: [503, 503, 200] },
  reject: { label: "Permanent rejection", codes: [400] },
  exhaust: { label: "Persistent outage", codes: [503, 503, 503, 503] },
} as const;

export const capacity = 30;
const delays = [2, 4, 8];
export const maxRunSteps = capacity * (1 + (delays.length + 1) + delays.length);

export type Scenario = keyof typeof scenarios;
type Code = 200 | 400 | 503;

type Attempt = {
  at: number;
  code: Code;
  retryAt: number | null;
};

export type Delivery = {
  id: number;
  scenario: Scenario;
  dueAt: number | null;
  attempts: Attempt[];
};

export type Queue = {
  now: number;
  deliveries: Delivery[];
};

export function enqueue(queue: Queue, id: number, scenario: Scenario) {
  if (queue.deliveries.some((delivery) => delivery.id === id)) return "duplicate";
  if (queue.deliveries.length >= capacity) return "full";
  queue.deliveries.push({ id, scenario, dueAt: queue.now, attempts: [] });
  return "queued";
}

export function nextDelivery(queue: Queue) {
  let next: Delivery | undefined;
  for (const delivery of queue.deliveries) {
    if (delivery.dueAt === null || delivery.dueAt > queue.now) continue;
    if (next?.dueAt == null || delivery.dueAt < next.dueAt) next = delivery;
  }
  return next;
}

export function processNext(queue: Queue) {
  const delivery = nextDelivery(queue);
  if (!delivery) return;

  const attemptIndex = delivery.attempts.length;
  const code = scenarios[delivery.scenario].codes[attemptIndex];
  const retryAt = code === 503 && attemptIndex < delays.length
    ? queue.now + delays[attemptIndex]
    : null;
  delivery.attempts.push({ at: queue.now, code, retryAt });
  delivery.dueAt = retryAt;
  return delivery;
}

export function nextRetry(queue: Queue) {
  let soonest = Infinity;
  for (const { dueAt } of queue.deliveries) {
    if (dueAt !== null && dueAt > queue.now) soonest = Math.min(soonest, dueAt);
  }
  return Number.isFinite(soonest) ? soonest : null;
}

export function advanceToRetry(queue: Queue) {
  const retryAt = nextRetry(queue);
  if (retryAt !== null) queue.now = retryAt;
  return retryAt;
}

export function deliveryStatus(delivery: Delivery, now: number) {
  if (delivery.dueAt !== null) return delivery.dueAt > now ? "Waiting" : "Ready";
  return delivery.attempts.at(-1)?.code === 200 ? "Delivered" : "Failed";
}
