---
name: Legacy ownership recovery
description: Safe recovery pattern for old events that have neither an account owner nor a usable admin key.
---

For an ownerless legacy event with no admin key, use an event-specific, login-required claim flow protected by an unguessable one-time token. Store only the token hash in code or configuration, make the claim idempotent for the resulting owner, and reject reassignment after ownership is set.

**Why:** A public event URL alone is not proof of ownership. This approach recovers an event without exposing a general-purpose endpoint that could claim arbitrary legacy events.

**How to apply:** Use only for individually verified recovery cases. Prefer a generic browser-held admin-key migration when such proof exists; use the one-time token flow when the historical record has no ownership credential.