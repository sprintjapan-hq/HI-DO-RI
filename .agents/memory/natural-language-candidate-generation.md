---
name: Natural-language candidate generation
description: Confirmed behavior of generating event candidates from conversational Japanese scheduling constraints.
---

Treat conversational Japanese such as weekday-only, evening start, and duration constraints as a supported organizer workflow.

**Why:** The organizer confirmed on 2026-09-05 that the second requested workflow generated usable candidates and successfully created a new event in the test environment.

**How to apply:** Preserve conversational input support and verify future parser changes against combined weekday, start-time, duration, and calendar-availability constraints.