# Architecture and security

## Ownership and inheritance

`templates.scope` distinguishes global and organization templates. Global templates own standard `template_items`. Organization templates have a fixed organization and global-parent link, and own only local items. Steps have no reusable library source.

An organization template loads its active parent items live. Inherited instructions, repetition, and ordering are read-only in the child API and editor. Local items use start/end placement or before/after placement anchored to a stable parent item ID. Parent reordering carries anchored additions. Soft-deleting a parent item retains local anchors; missing anchors remain visible and block new checklist creation. A global template with active child links cannot be deleted.

Metadata, item, and ordering mutations lock the parent before the child to provide a consistent lock order. Expected versions and complete expected/proposed order membership prevent lost updates. Organization ordering writes only that child's owned items. Restoring order rejects changed membership or invalid anchors. Restoring content records the prior state and advances versions; restoring a deleted item resolves position collisions without overwriting another item.

## Authoring and validation

TipTap instructions are constrained JSON: unknown nodes/marks are removed, depth/collection sizes are capped, and links are restricted to HTTP, HTTPS, and mailto. React renders snapshots without raw HTML injection.

Autosave is queued per entity and uses expected item versions. Navigation, preview, and structural mutations flush pending saves. Failed drafts remain in the page for retry or explicit discard. The editor refreshes saved template data periodically and on focus; inherited changes appear automatically.

Preview, Variables, Validation, and checklist creation use the same merged-template renderer and stored organization context. Only enabled, approved definitions and projected normalized fields are exposed. Invalid unused variables are visible but do not block a template. Required missing/stale/schema-incompatible values, unresolved tokens, invalid repetition, missing anchors, empty results, and more than 1,000 expanded steps block creation. Rendering an oversized result records a validation failure rather than saving a truncated checklist.

These workflows do not send IT Glue requests.

## Frozen checklists

Creation uses a repeatable-read transaction and parent/child locks. It validates enabled organization ownership and current approved values, then saves:

- Resolved rich instructions and titles, immutable positions, source item IDs, and repetition indexes.
- Referenced approved normalized values and refresh timestamps.
- Organization-template and global-template versions and display-name snapshots.
- An initial activity event and sanitized security audit event.

The creator plus a UUID creation key is unique. Retries reuse the existing instance; conflicting key reuse is rejected. Bounded retries cover transaction conflicts. Inserts are batched to stay below PostgreSQL parameter limits, without partial or truncated results.

Progress updates lock the checklist and step, require the expected step version, and return 409 on conflicts. Instructions, ordering, and source snapshots are not accepted by the progress API. Each step is pending, completed, or skipped. Skipping requires a non-empty reason; notes and reasons are plain text limited to 2,000 characters. Actor/time fields and append-only activity records are saved in the same transaction as progress and aggregate completion.

All terminal steps complete the checklist; reopening any step reopens it. Completed and skipped counts stay separate. Administrators can soft-delete and restore instances, with no permanent-delete API. Deleting a source template does not remove its existing instances.

## Access and credentials

Only enabled users authenticated in the configured Entra tenant can use production. Admins/editors author templates; viewers can inspect them. All three roles can create and work on shared checklists. Only admins manage mappings/users and delete/restore checklist instances.

Database clients, Auth.js configuration, and IT Glue credentials remain server-side. Synchronization retains only approved normalized fields; raw IT Glue responses, secret headers, password/upload traits, and unrestricted tag payloads are not persisted or sent to browsers. Errors are generic and do not log query payloads or credentials. User-authored notes and their changes are visible to authorized users in checklist activity, not written into security audit details.

## Reset and migration

Migration `0001_template_execution_redesign` clears only legacy templates, items, libraries, and template/step/order revisions; it records a reset audit event. Users, roles, organizations, approved definitions/mappings, normalized values, synchronization history, and prior security audits are retained. The migration runner requires `--confirm-template-reset` while that migration is pending, and journals the schema/reset atomically.

Seed uses insert-on-conflict-do-nothing. It does not restore legacy libraries, create starter templates, or overwrite an approved/disabled/soft-deleted mapping. Isolated PGlite tests exercise both migrations with realistic legacy fixtures and verify preservation and repeated seeding.
