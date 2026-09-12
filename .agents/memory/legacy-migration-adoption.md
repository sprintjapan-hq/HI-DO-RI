---
name: Legacy migration adoption
description: How to adopt databases partially updated by the former schema-push workflow without replaying already-applied changes.
---

Legacy database adoption must recognize both the original baseline and valid intermediate schemas where later additive changes were already applied outside migration history. Seed history only through the migrations whose effects are verified as present; leave later migrations pending.

**Why:** A database can have a nullable column added by the former push workflow while its Drizzle migration table remains empty. Treating only the original schema as adoptable blocks setup, while recording every migration could silently skip unapplied changes.

**How to apply:** For each supported intermediate schema, verify columns, constraints, and indexes exactly, then record only the corresponding migration prefix. Keep a normal committed migration for fresh databases and verify the migration command succeeds twice.