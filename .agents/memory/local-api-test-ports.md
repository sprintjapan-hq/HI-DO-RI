---
name: Local API test ports
description: Avoid false readiness when API integration tests start a local server beside Replit artifact workflows.
---

Reserve an ephemeral loopback port before starting a local API test server, then verify the expected health-response payload rather than accepting any successful HTTP response.

**Why:** Arbitrary local ports can already be served by another artifact workflow. A generic successful response can therefore hide a failed child process and send tests to an unrelated HTML service.

**How to apply:** For API integration tests that spawn a server, bind a temporary loopback server to port zero, release the assigned port, pass it to the child process, and require the API's known health JSON before running assertions.

Keep organizers isolated across independent poll-creation test scenarios; do not weaken the application's creation quota for tests.

**Why:** A shared organizer accumulates created polls across scenarios and can hit the normal rolling quota, causing unrelated tests to fail with HTTP 429 as the suite grows.

Do not run multiple calendar-sync test servers with separate Google mocks concurrently against the same database.

**Why:** Their retry workers share the job queue and can claim each other's test jobs, sending requests to the wrong mock and making retry/adoption assertions nondeterministic.

**How to apply:** Isolate their databases or run the integration files serially; unique poll IDs and organizer IDs alone do not isolate a shared background queue.