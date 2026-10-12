# Architecture and security notes

Template entries are deliberately polymorphic:

- A global entry stores the global step ID. Rendering always loads its current title, rich body, and repeat setting, so library changes propagate immediately.
- An organization entry stores copied title/body/repeat values plus its source organization-step ID. Later library edits cannot mutate existing template snapshots.
- Organization entries point to a global template-entry ID and `before`/`after` placement. A missing global anchor is a validation error and the snapshot is not silently relocated.

Rich text is stored as constrained TipTap JSON. Server input drops unknown nodes and marks, restricts heading levels, caps depth and collection sizes, and keeps only `http`, `https`, and `mailto` links with safe relationship attributes.

Autosave writes are debounced in the editor. Revisions coalesce changes occurring within a 30-second checkpoint window; restoration first records the current state and then applies the historical snapshot, making restore itself reversible.

The editor queues saves by entity, so changing selection does not discard pending edits. Navigation, preview, and order changes flush the queue first. Failed writes remain queued for an explicit retry.

Template ordering is saved through `PATCH /api/templates/[id]/order`. The server locks the template, compares the client's expected item membership and placement, and applies the complete scoped ordering with its revision and audit event in one transaction. Global moves preserve every organization's anchors; individual organization moves explicitly change that snapshot's anchor. Restoring an order revision rejects changed membership. Recovering a removed global entry uses its old position when available and appends it when that position is occupied.

`/global-library` exposes live step editing, template usage, repetition, and deleted-step recovery. The template context endpoint reads approved normalized values from PostgreSQL and shares validation with preview. Opening Variables or Validation does not call IT Glue. Readiness checks apply to the selected organization's referenced variables; unused invalid variables remain visible without blocking the template.

Database clients, Auth.js configuration, and the IT Glue API key exist only in server modules. No raw IT Glue payload, secret header, password/upload trait, or unrestricted tag payload is returned to browser code or written to PostgreSQL.
