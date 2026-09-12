---
name: Organizer calendar ownership
description: Security boundary for organizer-owned Google Calendar access and confirmed event creation.
---

Use Clerk-managed Google OAuth tokens scoped to each authenticated organizer. Keep only the enabled app-connection marker and external-account identifier in the application database; never copy OAuth tokens into it.

**Why:** A workspace-level connector can expose one person's calendar to unrelated organizers. Client-held candidate times can also drift or be manipulated before event creation.

Production access has been organizer-confirmed with a dedicated Google OAuth client, Calendar authorization, repeat candidate extraction, poll creation, and participant sharing. On 2026-09-07, the organizer also confirmed the full lifecycle in the real Google Calendar: all adopted candidates appeared as tentative events after poll creation, then confirmation removed every tentative event and left only the selected event.

**How to apply:** Resolve tokens from the authenticated Clerk user on every calendar request, require an enabled user-bound connection, and derive event times from the server-stored confirmed candidate after poll ownership checks. Treat the dedicated production OAuth client as the known-good path.