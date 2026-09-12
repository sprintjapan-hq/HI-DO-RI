---
name: Release history publishing
description: Rules for keeping shipped features visible and automatically publishing operator-approved release information.
---

Treat the note entered with the final completion action as public release text and display completed items through the release-history API.

**Why:** The history page was a hardcoded array, so publishing new code could not add release information automatically. Separately, development-only feature gates made tested functionality disappear from the published build.

**How to apply:** Require a non-empty public note before completion, expose only that note and completion time publicly, and verify user-facing features under production build conditions rather than relying only on the development preview.