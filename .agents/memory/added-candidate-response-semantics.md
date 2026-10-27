---
name: Added candidate response semantics
description: How existing participant responses should behave when an organizer appends candidate dates.
---

When candidate dates are appended to an open event, keep every existing participant's answer array unchanged. Display the newly appended positions as unanswered rather than assigning ○, △, or ×.

**Why:** Automatically assigning × or another answer would falsely claim that a participant expressed a preference they never submitted.

**How to apply:** Any future candidate-editing, aggregation, export, or notification work must distinguish a missing answer from an explicit `no` response and preserve the original submitted answers.

Treat a replacement date as removal of the old candidate plus addition of a new one, rather than silently applying the old candidate's responses to a different date.

**Why:** A participant's ○・△・× expresses availability for the original date, not consent to a replacement date. Retaining it for a different date would misrepresent their answer.

**How to apply:** When adding direct date/time editing in the future, explicitly decide how to invalidate affected answers; do not reuse them automatically. Answers for unchanged dates must remain associated with those dates.