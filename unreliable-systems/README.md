# Run a webhook until it fails

You will store one webhook, then make the same delivery fail on purpose. Each post tells you what the sender saw. The queries tell you what Postgres kept. Those two reports are allowed to disagree.

Run the commands from `unreliable-systems`. The stack is Postgres, the receiver, and the sender.

## Start the services

Build and start the three containers.

```sh
docker compose up --build -d
```

Postgres becomes healthy, then the receiver, then the sender.

Clear the tables between scenarios.

```sh
docker compose exec postgres psql -U lab -d lab -c "TRUNCATE events, delivery_attempts RESTART IDENTITY"
```

psql prints `TRUNCATE TABLE`.

After you change `db/init.sql`, remove the data volume before the next start. Postgres runs that file only when the volume is empty.

```sh
docker compose down -v
```

## Store one event

Post the happy scenario.

```sh
curl -s -X POST localhost:3001/scenarios/happy
```

The sender answers HTTP 200. Inside the report, `verdict` is `acked` and the attempt status is 201. `eventId` and `payloadSha256` change on every post.

Read the rows.

```sh
docker compose exec postgres psql -U lab -d lab -c "select event_id, payload_sha256 from events"
docker compose exec postgres psql -U lab -d lab -c "select sender_attempt, outcome, payload_sha256 from delivery_attempts order by id"
```

One event row. One attempt row with `sender_attempt` 1 and `outcome` `stored`. The two hashes match the report.

## Send the same event again

```sh
curl -s -X POST localhost:3001/scenarios/duplicate
```

The first attempt is 201 `stored`. The second is 200 `duplicate`. Both verdicts are `acked`. The query shows one event and two attempts. The hashes match. The second request did not insert another event.

## Change the body and keep the id

```sh
curl -s -X POST localhost:3001/scenarios/conflict
```

The second attempt is 409 `conflict`, and that verdict is `rejected`. One event remains. Its hash matches the first body. The second attempt hash is different.

## Send a body the receiver will not store

```sh
curl -s -X POST localhost:3001/scenarios/invalid-json
curl -s -X POST localhost:3001/scenarios/invalid-shape
```

Each report is `rejected` with status 400. The attempt `outcome` is `invalid`, and `event_id` is null. The `events` table gains no row. `invalid-json` sends the bytes `nope`. `invalid-shape` sends `{}`.

A header `x-lab-fault` with any other name is also 400, and that request writes no row.

## Time out before the database commit

```sh
curl -s -X POST localhost:3001/scenarios/timeout-before-commit
```

The call takes a little over five seconds. The first attempt is `timeout`. The retry is 201 `stored`. The sender verdict is `acked`.

Read the attempts ordered by `recorded_at`. Attempt 2 is `stored`. Attempt 1 is `duplicate`. The retry committed while the first request was still waiting, and the late request then found the row.

## Time out after the commit

```sh
curl -s -X POST localhost:3001/scenarios/timeout-after-commit
```

The first attempt is `timeout` again. The retry is 200 `duplicate`. Ordered by `recorded_at`, attempt 1 is `stored` and attempt 2 is `duplicate`. The receiver had committed before the sender stopped waiting.

## Follow that timeout in the logs

The curl JSON has `traceId` on the send. Every log line for that send uses the same `trace_id`.

```sh
docker compose logs sender receiver
```

Find the JSON lines with that id.

The sender line for attempt 1 has `"observation":"timeout"`. The receiver line for attempt 1 has `"outcome":"stored"` and a later `time`. The sender had stopped waiting. The receiver had already committed, then held the response. The retry lines use the same `trace_id`. The receiver line for attempt 2 has `"outcome":"duplicate"`.

Under each JSON line, the span printout names the parent. The receiver span's `parentSpanContext.spanId` equals the sender attempt's `span_id`. `status.code` 2 on the sender attempt is the timeout. `status.code` 0 on the receiver span means the handler finished. The row is `stored`.

## A sender clock that is wrong

```sh
curl -s -X POST localhost:3001/scenarios/clock-skew
```

The event is stored. `occurred_at` is about one hour later than `received_at`. The receiver keeps the timestamp the sender wrote. It does not replace that timestamp with its own clock.

```sh
docker compose exec postgres psql -U lab -d lab -c "select occurred_at, received_at from events e join delivery_attempts a on a.event_id = e.event_id and a.outcome = 'stored'"
```

The lab does not change the computer's clock. The hour is a value in the JSON. Two containers on one machine still share a close clock.

## Two events arrive in the wrong order

```sh
curl -s -X POST localhost:3001/scenarios/out-of-order
```

The first request carries an `occurred_at` one hour ahead. The second carries an `occurred_at` one hour behind. Both are stored. Ordered by `received_at`, the later event arrived first. Ordered by `occurred_at`, that order flips. Arrival order is not the order the sender claims.

## A message that sits on the network

```sh
curl -s -X POST localhost:3001/scenarios/delayed-delivery
```

The call waits about three seconds. The sender writes `occurred_at` first, then waits, then posts. `received_at` is those three seconds later. Nothing is in Postgres during the wait, because the receiver has not seen the request yet.

## Two copies in flight together

```sh
curl -s -X POST localhost:3001/scenarios/parallel-duplicate
```

The sender posts the same bytes twice without waiting for the first answer. Both reports are `acked`. One attempt is `stored` and the other is `duplicate`. Which request wins can change from run to run. One event row remains.

## Stop the receiver

Stop the receiver, post the happy scenario, and start the receiver during the retries.

```sh
docker compose stop receiver
curl -s -X POST localhost:3001/scenarios/happy
```

In another terminal, after a few seconds:

```sh
docker compose start receiver
```

The attempts come back as `timeout`. On this Docker network a stopped receiver does not refuse the connection. The sender waits until its two second deadline. A dead receiver and a slow receiver look the same in that report. The rows are what separate them. If you start the receiver before the retries end, the verdict is `acked` and a row appears. If you leave it stopped, the verdict is `gave-up` and no new row appears.

## Stop Postgres and leave the receiver running

```sh
docker compose stop postgres
curl -s -X POST localhost:3002/webhooks -H "content-type: application/json" -d nope
```

The receiver answers 503 `unavailable`. The receiver container stays up. No new row is written, because the transaction did not commit.

Start Postgres again, wait until it is healthy, and post the happy scenario. The next valid event stores.

```sh
docker compose start postgres
docker compose up -d --wait
curl -s -X POST localhost:3001/scenarios/happy
```

`node probe.mjs` runs these scenarios and the two outages, then clears the tables.
