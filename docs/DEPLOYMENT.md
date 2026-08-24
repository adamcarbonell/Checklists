# Northflank deployment

The committed template targets project **Checklists** in **us-central**, leaves the Northflank-generated hostname enabled, and provisions:

- One `nf-compute-20` web replica (the modest shared plan nearest the requested 0.25 vCPU / 512 MiB target).
- PostgreSQL 16, one `nf-compute-50` replica, 10 GiB NVMe storage, private networking, and no backup schedules.
- A migration/seed job with a 30-minute timeout and two bounded retries.
- A read-only IT Glue cron job at `0 */6 * * *` UTC, overlap forbidden, 30-minute timeout, and two bounded retries.
- HTTP liveness and database-readiness probes.

No credentials are stored in the repository or template. Disabling database backups is intentional for v1 and means revisions and audit history can be lost after an unrecoverable database failure.

## One-time bootstrap

1. Connect the private `adamcarbonell/Checklists` GitHub repository to Northflank.
2. Create or import a GitOps template from `/northflank/template.json` on `main`, enable automatic runs, and keep concurrency set to **forbid**.
3. Run the template. Wait for PostgreSQL, the web build, migration job, cron job, and `checklists-runtime` secret group to exist.
4. In `checklists-runtime`, enter these values directly in Northflank—never in Git or chat:
   - `ITGLUE_API_KEY`
   - `ENTRA_TENANT_ID`
   - `ENTRA_CLIENT_ID`
   - `ENTRA_CLIENT_SECRET`
   - `BOOTSTRAP_ADMIN_EMAIL=adam@version2llc.com`
   - `AUTH_SECRET=${fn.randomSecret(64)}` using Northflank’s secret generator
5. Confirm the PostgreSQL `POSTGRES_URI` linked dependency is exposed under the `DATABASE_URL` alias.
6. Obtain the generated HTTPS hostname from the public `http` port.
7. In the single-tenant Microsoft Entra app registration, add this exact web redirect URI:
   `https://<northflank-hostname>/api/auth/callback/microsoft-entra-id`
8. Grant only the OpenID scopes used by the app: `openid`, `profile`, and `email`. No Microsoft Graph application permissions are required.
9. Restart the web service and jobs so they inherit the completed secret group.
10. Run `checklists-migrate` once. It applies migrations and idempotently seeds the two approved mappings and starter template.
11. Run `checklists-itglue-sync` once after enabling at least one organization in the admin UI.
12. Sign in as `adam@version2llc.com` and verify `/api/health/live`, `/api/health/ready`, organization sync, variable validation, and a template preview.

Auth.js verifies the Entra `tid` claim server-side. The bootstrap email is promoted only when first seen in the approved tenant; every other new tenant user starts as a viewer.

## Migration-first releases

Import `/northflank/release-flow.json` into a production pipeline stage, attach `checklists-web` and `checklists-migrate`, and connect the Git trigger to `main`. The flow deploys the selected build to the migration job, waits for a successful run, and only then promotes the same build to the web service. A failed migration prevents web promotion.

After GitOps is connected, pushes to `main` trigger builds and the release flow. Keep the combined service’s deployment under release-flow control in the Northflank UI so its normal CD path cannot bypass migrations.

## IT Glue safety model

Every request is server-side `GET` only. Before sending it, the application records a sanitized preview with method, endpoint class, exact filters, projected fields, result limit, sensitivity, and expected side effects. Sync projects only explicitly approved fields, discards all other traits immediately, filters archived assets, and never persists raw API responses or headers.

The client requests at most 1,000 records and fails validation if IT Glue reports more or provides a next page. Transient 429/5xx responses receive at most three total attempts. Invalid refreshes preserve the last good normalized value, mark only the affected organization/variable invalid or stale, and block only that organization’s preview. Values become stale 24 hours after their last successful refresh.

## Rollback

Application rollback is performed by promoting a prior successful build through the same release flow. Database migrations are forward-only; create a reviewed compensating Drizzle migration if a schema rollback is necessary. With backup retention disabled, there is no automatic database point-in-time recovery.
