---
name: Added candidate response semantics
description: How existing participant responses should behave when an organizer appends candidate dates.
---

When candidate dates are appended to an open event, keep every existing participant's answer array unchanged. Display the newly appended positions as unanswered rather than assigning ○, △, or ×.

**Why:** Automatically assigning × or another answer would falsely claim that a participant expressed a preference they never submitted.

**How to apply:** Any future candidate-editing, aggregation, export, or notification work must distinguish a missing answer from an explicit `no` response and preserve the original submitted answers.