import test from "node:test";
import assert from "node:assert/strict";
import { capacity, deliveryStatus, enqueue, nextRetry, processNext } from "../src/queue.ts";

const empty = () => ({ now: 0, deliveries: [] });

test("a temporary outage delays retries and succeeds on the third attempt", () => {
  const queue = empty();
  enqueue(queue, 1, "recover");
  const delivery = processNext(queue);
  assert.equal(deliveryStatus(delivery, queue.now), "Waiting");
  assert.equal(nextRetry(queue), 2);
  assert.equal(processNext(queue), undefined);
  queue.now = 1;
  assert.equal(processNext(queue), undefined);
  queue.now = 2;
  processNext(queue);
  assert.equal(nextRetry(queue), 6);
  queue.now = 6;
  processNext(queue);
  assert.deepEqual(delivery.attempts, [
    { at: 0, code: 503, retryAt: 2 },
    { at: 2, code: 503, retryAt: 6 },
    { at: 6, code: 200, retryAt: null },
  ]);
  assert.equal(deliveryStatus(delivery, queue.now), "Delivered");
  assert.equal(nextRetry(queue), null);
  assert.equal(processNext(queue), undefined);
});

test("a persistent outage stops after four attempts with 2, 4 and 8 second backoff", () => {
  const queue = empty();
  enqueue(queue, 1, "exhaust");
  for (const time of [0, 2, 6, 14]) {
    queue.now = time;
    processNext(queue);
  }
  assert.deepEqual(queue.deliveries[0].attempts.map(({ retryAt }) => retryAt), [2, 6, 14, null]);
  assert.equal(deliveryStatus(queue.deliveries[0], queue.now), "Failed");
  assert.equal(nextRetry(queue), null);
  assert.equal(processNext(queue), undefined);
});

test("a permanent rejection does not retry", () => {
  const queue = empty();
  enqueue(queue, 1, "reject");
  const delivery = processNext(queue);
  assert.deepEqual(delivery.attempts, [{ at: 0, code: 400, retryAt: null }]);
  assert.equal(deliveryStatus(delivery, queue.now), "Failed");
});

test("an existing event ID stays deduplicated before and after processing", () => {
  const queue = empty();
  assert.equal(enqueue(queue, 1, "success"), "queued");
  assert.equal(enqueue(queue, 1, "reject"), "duplicate");
  assert.equal(processNext(queue).attempts[0].code, 200);
  assert.equal(enqueue(queue, 1, "recover"), "duplicate");
  assert.equal(queue.deliveries.length, 1);
  assert.equal(processNext(queue), undefined);
});

test("ready work proceeds while a retry waits, in due-time then insertion order", () => {
  const queue = empty();
  enqueue(queue, 1, "recover");
  enqueue(queue, 2, "success");
  enqueue(queue, 3, "reject");
  assert.equal(processNext(queue).id, 1);
  assert.equal(processNext(queue).id, 2);
  queue.now = 2;
  assert.equal(processNext(queue).id, 3);
  assert.equal(processNext(queue).id, 1);
});

test("the session is bounded without losing the existing history", () => {
  const queue = empty();
  for (let id = 1; id <= capacity; id++) assert.equal(enqueue(queue, id, "success"), "queued");
  assert.equal(enqueue(queue, capacity + 1, "success"), "full");
  assert.equal(enqueue(queue, 1, "reject"), "duplicate");
  assert.equal(queue.deliveries.length, capacity);
});
