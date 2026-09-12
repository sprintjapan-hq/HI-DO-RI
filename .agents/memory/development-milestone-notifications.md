---
name: Development milestone notifications
description: Confirmed behavior and operating rule for feature-request progress notifications sent to Slack.
---

Use structured development milestones for Slack updates, with the final completion notification triggered explicitly from the operator screen. Route all feature-request intake, retry, progress, and completion notifications to the dedicated `hi-do-ri_feedback` channel.

**Why:** The operator confirmed on 2026-09-05 that milestone and completion messages arrived correctly. On 2026-09-07, the dedicated `hi-do-ri_feedback` route was selected and its production delivery was confirmed end-to-end.

**How to apply:** Keep completion as an explicit operator action, preserve milestone ordering, do not mark database progress when Slack delivery fails, and use the shared feature-request channel setting for every notification stage.