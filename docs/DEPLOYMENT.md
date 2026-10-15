# Northflank deployment and redesign cutover

## Existing deployment: keep the infrastructure

This redesign uses the existing **Checklists** project in **us-central**, PostgreSQL add-on, generated hostname, secret inheritance, Entra registration, and backup settings. **Do not rerun the infrastructure template, replace PostgreSQL, change the database URI, or rotate credentials for this release.**

The schema is incompatible with the legacy editor. Do not promote the redesigned web image before migration, or run the legacy web image after the new migration.

## One-time redesign cutover

The reset permanently removes existing test templates, reusable libraries, and their template/step/order revisions. It preserves users/roles, organizations, variable mappings/values, sync history, and security audits. Backup retention remains disabled as requested; this reset cannot be undone through the application.

1. Reconfirm that permanent test-template reset. Keep **Continuous delivery (CD) off** on `checklists-web`; CI can remain on.
2. Build the tested commit from `main`. Note the successful build ID and commit. Use that exact image for migration and web, not independently selected “latest” images.
3. Briefly pause `checklists-web` (or scale its running instances to zero) and wait until web writes stop. Leave the PostgreSQL add-on running. No secrets need changing.
4. Select that build for `checklists-migrate`. For this one-time run, use this custom command or equivalent run-level command override:

   ```sh
   sh -c "node node_modules/tsx/dist/cli.mjs scripts/migrate.ts --confirm-template-reset && node node_modules/tsx/dist/cli.mjs scripts/seed.ts"
   ```

   Keep the `sh -c` wrapper. Northflank does not interpret bare `&&` in its command field as a shell operator.

5. Run the migration job and require a successful result. Without the confirmation flag, the job deliberately refuses the pending reset. If migration fails, **do not promote web**. The schema/reset/journal transaction rolls back on failure; investigate using sanitized diagnostics.
6. Restore the normal migration command, without the flag:

   ```sh
   sh -c "node node_modules/tsx/dist/cli.mjs scripts/migrate.ts && node node_modules/tsx/dist/cli.mjs scripts/seed.ts"
   ```

7. Promote the **same successful build ID** to `checklists-web` and resume one running instance. Do not resume its old image against the new schema.
8. Verify liveness/readiness and sign in at the unchanged public URL. Global templates and runnable checklists start empty; preserved organizations and approved mappings should still be present.
9. Perform the authenticated checks below before treating the cutover as complete.

## Migration-first releases after cutover

### Conditional-groups release (0002)

This release is additive and preserves existing templates, steps and IDs, revisions, runnable checklists/progress, organization mappings/values, synchronization, users, and audit history. **Do not supply `--confirm-template-reset`.** Do not rerun the infrastructure template or change secrets.

1. Build the tested commit with direct web CD off. Record its successful build ID.
2. Briefly scale web to zero and wait for all instances/writes to stop. Keep PostgreSQL and the sync schedule unchanged.
3. Pin `checklists-migrate` to that exact web build ID using its normal forward-only command: `sh -c "node node_modules/tsx/dist/cli.mjs scripts/migrate.ts"`. Run once and require success. The migration journal ensures reruns do not repeat already-applied migrations, including the previous reset.
4. Promote the same successful build to web, resume one instance, and require both public health endpoints to return 200. New readiness checks require the branch table and node columns.
5. Verify authenticated conditional editing, nested placement/reload, selected-branch preview, inherited read-only rules, local additions, and unchanged existing checklists. Do not run an old editor after authoring conditional content; fix forward if necessary.

The isolated database tests verify the additive migration and idempotent journal behavior without relying on production data. They do not replace authenticated post-deployment checks.

`northflank/release-flow.json` selects/reuses a successful build once, references its build ID for the migration job, waits for migration success, then promotes that same ID to web. This avoids different “latest” builds being chosen while another commit arrives. Configure/import this release flow in the existing pipeline; attach the existing web service and migration job. Do not import the infrastructure provisioning template for an update.

Keep combined-service CD off so it cannot bypass migrations. Git triggers can run the flow for `main`. The routine flow does **not** authorize the one-time template reset; complete the guarded cutover manually first. Northflank's official [release-flow guide](https://www.northflank.ai/docs/v1/application/release/pipeline/configure-a-release-flow) describes build references and migration sequencing; [CI/CD guidance](https://northflank.com/docs/v1/application/release/manage-ci-cd) explains disabling direct CD.

The migration journal is in PostgreSQL's `public` schema, avoiding `CREATE SCHEMA` permissions unavailable to the standard add-on role.

## Authenticated acceptance checks

- Sign in as an admin/editor; create a global template with two standard steps and variables/repetition as needed.
- Inside an enabled organization, create a linked template and local steps. Check inherited steps are read-only and local content is isolated to this template.
- Reorder global steps and check local anchors move with them. Reorder/reanchor a local step with pointer and keyboard controls; reload to verify persistence.
- Remove a global anchor: its local additions must remain visibly unplaced and creation must be blocked until repaired. Recover the step through history.
- Create a named checklist from valid stored organization data. Change the source template and verify existing run instructions/order/variables remain frozen.
- Complete a step, skip another with a required reason, add notes, finish the run, and reopen a step. Verify separate counts and actor/timestamp/activity records.
- Check two-user progress conflicts return 409 without losing drafts.
- A viewer must be able to create/work on checklists but not author templates. Disabled users must not access either workflow.
- Verify admin-only checklist soft-delete/recovery, account sign-out, and explicit empty/unavailable states.

Local tests cover the isolated-database reset, atomic rollback, inheritance, snapshots, conflicts, permissions, and controls. They do not prove the live Northflank image or Entra session is correct; the post-cutover checks are still required.

## New installations only

`northflank/template.json` provisions PostgreSQL 16, a modest single web instance, migration job, six-hour read-only sync cron, and health checks. It is **not** an update mechanism for the existing project.

Enter `ITGLUE_API_KEY`, `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `AUTH_SECRET`, and `BOOTSTRAP_ADMIN_EMAIL` directly into Northflank secret groups; never send them in chat or commit them. Inherit `DATABASE_URL` from PostgreSQL. Set Auth.js's public HTTPS URL and register `/api/auth/callback/microsoft-entra-id` at that hostname in the single-tenant Entra application. The first bootstrap administrator is `adam@version2llc.com`; other new tenant users start as viewers.

Fresh databases also require the explicit guarded migration flag on the first run. Seed inserts missing default variable mappings only. Enable organizations and run the existing IT Glue sync job afterward. No template or library seed data is created.

## IT Glue and rollback

IT Glue requests stay server-side, GET-only, and read-only. Each request has a sanitized preview, narrow filters/approved fields, bounded retries, and a 1,000-record ceiling. Last-good values are preserved on invalid refreshes; freshness expires after 24 hours.

Migrations are forward-only. After the redesign migration, the old editor image is not a compatible rollback. Use a fixed build or a reviewed forward migration. With backups disabled, no automatic point-in-time recovery is available.
