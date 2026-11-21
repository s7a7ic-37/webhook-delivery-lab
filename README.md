# Webhook Delivery Lab

A browser simulation of a webhook queue and a fixed fictional receiver. Queue an event, process one delivery at a time, and advance the simulation clock to make each retry eligible.

[Open the demo](https://webhooks.artemislab.co.uk/).

- Temporary failures return 503. Retries wait 2, 4 and 8 seconds, with up to four attempts.
- A permanent rejection returns 400 and ends the delivery. A 200 completes it.
- Requeuing an existing event ID leaves the existing delivery and its history intact.
- Export every processed attempt in the current run as CSV. Rows follow processing order, including attempts at the same simulation time. Times are in seconds from the start of the run, with blank retry times for final responses.

The TypeScript queue selects the oldest due delivery, using insertion order for ties. The display shows each attempt, its response code and its next retry time. This tab keeps up to 30 events across reloads by replaying a bounded list of saved steps. Reset removes the saved run. The simulation also works when browser storage is unavailable. All receiver responses are local fixtures.

## Run locally

Use Node 24+ and Python 3.

    npm ci
    npm test
    npm run build
    python -m http.server 4189 --bind 127.0.0.1 --directory dist

Open http://127.0.0.1:4189/. The dist directory can be served by a static host.
