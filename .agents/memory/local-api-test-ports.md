---
name: Local API test ports
description: Avoid false readiness when API integration tests start a local server beside Replit artifact workflows.
---

Reserve an ephemeral loopback port before starting a local API test server, then verify the expected health-response payload rather than accepting any successful HTTP response.

**Why:** Arbitrary local ports can already be served by another artifact workflow. A generic successful response can therefore hide a failed child process and send tests to an unrelated HTML service.

**How to apply:** For API integration tests that spawn a server, bind a temporary loopback server to port zero, release the assigned port, pass it to the child process, and require the API's known health JSON before running assertions.