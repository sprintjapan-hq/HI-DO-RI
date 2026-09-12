---
name: OpenAPI integer generation compatibility
description: How to avoid generated Zod validators that are incompatible with the workspace's current Zod runtime.
---

For API response identifiers and aggregate counts, use OpenAPI `number` rather than `integer` while this workspace's Orval and Zod versions remain as currently configured.

**Why:** Orval generates `zod.int()` for OpenAPI integers, but the installed Zod runtime does not expose that helper, causing the generated validation package to fail typechecking.

**How to apply:** After changing the OpenAPI contract, run code generation immediately. If the dependency versions are later aligned and `zod.int()` is supported, this workaround can be removed.