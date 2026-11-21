import { advanceToRetry, attemptsCsv, capacity, deliveryStatus, enqueue, eventName, nextDelivery, nextRetry, processNext, scenarios } from "./queue.js";
import type { Delivery, Scenario } from "./queue.js";
import { clearRun, loadRun, saveRun } from "./session.js";
import type { Step } from "./session.js";

let storage: Storage | undefined;
try {
  storage = window.sessionStorage;
} catch {
  // Some browser settings block access to session storage.
}
const { queue, steps, selectedId, status: loadStatus } = loadRun(storage);
const find = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const scenario = find<HTMLSelectElement>("scenario");
const deliveries = find<HTMLUListElement>("deliveries");
const attempts = find<HTMLOListElement>("attempts");
const message = find("message");
const queueButton = find<HTMLButtonElement>("enqueue");
const processButton = find<HTMLButtonElement>("process");
const advanceButton = find<HTMLButtonElement>("advance");
const exportButton = find<HTMLButtonElement>("export-attempts");
const resetButton = find<HTMLButtonElement>("reset");
const storageNote = find("storage-note");
let selected: Delivery | undefined = queue.deliveries.find(delivery => delivery.id === selectedId);

const time = (seconds: number) => String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
const setUnavailable = (button: HTMLButtonElement, value: boolean) => button.setAttribute("aria-disabled", String(value));
const text = (id: string, content: string) => { find(id).textContent = content; };
const responses = { 200: "Delivered", 400: "Bad request", 503: "Service unavailable" };

function showStorageNote(note: string) {
  storageNote.textContent = note;
  storageNote.hidden = !note;
}

function remember(step?: Step) {
  if (step) steps.push(step);
  if (!selected) return;
  const saved = saveRun(storage, steps, selected.id);
  showStorageNote(saved ? "" : "This tab could not save the run. Reloading may lose recent changes.");
}

function renderDetails() {
  find("detail").hidden = !selected;
  find("detail-message").hidden = Boolean(selected);
  const badge = find("detail-status");
  badge.hidden = !selected;
  if (!selected) return;

  const status = deliveryStatus(selected, queue.now);
  const event = { id: eventName(selected.id), type: "order.ready" };
  badge.dataset.status = status;
  badge.textContent = status;
  text("event-name", event.id + " · " + event.type);
  text("event-json", JSON.stringify(event, null, 2));
  text("event-scenario", scenarios[selected.scenario].label);
  attempts.replaceChildren();
  find("attempt-empty").hidden = selected.attempts.length !== 0;
  for (const [index, attempt] of selected.attempts.entries()) {
    const row = document.createElement("li");
    const title = document.createElement("strong");
    const note = document.createElement("span");
    title.textContent = "Attempt " + (index + 1) + " · " + attempt.code + " " + responses[attempt.code];
    note.className = "muted";
    note.textContent = time(attempt.at) + (attempt.retryAt === null ? "" : " · Retry at " + time(attempt.retryAt));
    row.append(title, note);
    attempts.append(row);
  }
}

function render() {
  text("clock", time(queue.now));
  const retryAt = nextRetry(queue);
  setUnavailable(queueButton, queue.deliveries.length >= capacity);
  setUnavailable(processButton, !nextDelivery(queue));
  setUnavailable(advanceButton, retryAt === null);
  setUnavailable(exportButton, queue.attemptCount === 0);
  setUnavailable(resetButton, queue.deliveries.length === 0);
  text("advance", retryAt === null ? "Advance to retry" : "Advance to " + time(retryAt));
  text("summary", queue.deliveries.length + " of " + capacity);
  find("empty").hidden = queue.deliveries.length !== 0;

  deliveries.replaceChildren();
  for (const delivery of queue.deliveries) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const key = document.createElement("span");
    const badge = document.createElement("span");
    const note = document.createElement("span");
    const status = deliveryStatus(delivery, queue.now);
    button.className = "delivery";
    button.type = "button";
    button.setAttribute("aria-pressed", String(delivery === selected));
    key.className = "delivery-key";
    key.textContent = eventName(delivery.id);
    badge.className = "pill";
    badge.dataset.status = status;
    badge.textContent = status;
    note.className = "muted";
    note.textContent = status === "Waiting" && delivery.dueAt !== null
      ? "Retry at " + time(delivery.dueAt)
      : scenarios[delivery.scenario].label;
    button.addEventListener("click", () => {
      selected = delivery;
      deliveries.querySelector('[aria-pressed="true"]')?.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-pressed", "true");
      remember();
      renderDetails();
    });
    button.append(key, badge, note);
    item.append(button);
    deliveries.append(item);
  }
  renderDetails();

  const selectedRow = deliveries.querySelector('[aria-pressed="true"]');
  if (selectedRow) {
    const list = deliveries.getBoundingClientRect();
    const row = selectedRow.getBoundingClientRect();
    const topOffset = row.top - list.top;
    const bottomOffset = row.bottom - list.bottom;
    deliveries.scrollTop += topOffset < 0 ? topOffset : Math.max(0, bottomOffset);
  }
}

queueButton.addEventListener("click", () => {
  const value = scenario.value;
  if (!Object.hasOwn(scenarios, value)) return;
  const id = queue.deliveries.length + 1;
  if (enqueue(queue, id, value as Scenario) === "queued") {
    selected = queue.deliveries.at(-1);
    message.textContent = eventName(id) + " queued. Process next to make the first attempt.";
    remember(value as Scenario);
    render();
  } else {
    message.textContent = "The queue is full. Reset the simulation to add more events.";
  }
});

processButton.addEventListener("click", () => {
  const delivery = processNext(queue);
  if (!delivery) return;
  selected = delivery;
  const attempt = delivery.attempts.at(-1)!;
  message.textContent = eventName(delivery.id) + " received " + attempt.code + ". " +
    (attempt.retryAt === null
      ? (attempt.code === 200 ? "Delivery completed." : attempt.code === 400 ? "The receiver rejected this event." : "The retry limit was reached.")
      : "Next attempt is due at " + time(attempt.retryAt) + ".");
  remember("process");
  render();
});

advanceButton.addEventListener("click", () => {
  const retryAt = advanceToRetry(queue);
  if (retryAt === null) return;
  message.textContent = "Clock advanced to " + time(retryAt) + ". Process next to run a ready attempt.";
  remember("advance");
  render();
});

find("duplicate").addEventListener("click", () => {
  if (!selected) return;
  const result = enqueue(queue, selected.id, selected.scenario);
  if (result === "duplicate") message.textContent = "Duplicate " + eventName(selected.id) + " ignored. The original delivery is unchanged.";
});

exportButton.addEventListener("click", () => {
  if (queue.attemptCount === 0) return;
  const url = URL.createObjectURL(new Blob([attemptsCsv(queue)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "webhook-delivery-attempts.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});

resetButton.addEventListener("click", () => {
  if (queue.deliveries.length === 0) return;
  queue.now = 0;
  queue.attemptCount = 0;
  queue.deliveries.length = 0;
  steps.length = 0;
  selected = undefined;
  find<HTMLDetailsElement>("event-message").open = false;
  const cleared = clearRun(storage);
  showStorageNote(cleared ? "" : "This tab could not clear browser storage. An older run may return after reload.");
  message.textContent = "Simulation reset. Queue an event to start again.";
  render();
});

if (loadStatus === "restored") message.textContent = "Run restored from this tab.";
if (loadStatus === "discarded") message.textContent = "The saved run could not be restored. A new run is ready.";
if (loadStatus === "unavailable") showStorageNote("This tab could not use browser storage. Reloading may lose recent changes.");
render();
