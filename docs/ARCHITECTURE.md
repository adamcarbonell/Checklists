# Architecture and security notes

Template entries are deliberately polymorphic:

- A global entry stores the global step ID. Rendering always loads its current title, rich body, and repeat setting, so library changes propagate immediately.
- An organization entry stores copied title/body/repeat values plus its source organization-step ID. Later library edits cannot mutate existing template snapshots.
- Organization entries point to a global template-entry ID and `before`/`after` placement. A missing global anchor is a validation error and the snapshot is not silently relocated.

Rich text is stored as constrained TipTap JSON. Server input drops unknown nodes and marks, restricts heading levels, caps depth and collection sizes, and keeps only `http`, `https`, and `mailto` links with safe relationship attributes.

Autosave writes are debounced in the editor. Revisions coalesce changes occurring within a 30-second checkpoint window; restoration first records the current state and then applies the historical snapshot, making restore itself reversible.

Database clients, Auth.js configuration, and the IT Glue API key exist only in server modules. No raw IT Glue payload, secret header, password/upload trait, or unrestricted tag payload is returned to browser code or written to PostgreSQL.
