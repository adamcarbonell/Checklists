# Checklists

Private, organization-aware checklist template authoring for Version2. Global steps are live references; organization steps are anchored snapshots. Organization variables are normalized from read-only IT Glue flexible assets and validated before preview.

## Included in v1

- Next.js 16, TypeScript, PostgreSQL, Drizzle migrations, Auth.js, Microsoft Entra ID, and TipTap.
- Admin, editor, and viewer authorization boundaries.
- Global and organization step libraries, ordered template entries, soft deletion, revisions, restoration, and sanitized audit events.
- Scalar tokens, list variables, repeated steps, anchor validation, and organization-specific preview blocking.
- Seeded IT Glue mappings for `org.ad_full_name` (type `107504`) and `org.applications` (type `107505`).
- Bounded, read-only IT Glue synchronization every six hours with a 1,000-record ceiling and last-good-value preservation.
- Production Docker image, liveness/readiness endpoints, Northflank v1.2 GitOps template, and migration-first release flow.

Checklist execution, assignments, completion tracking, attachments, IT Glue writes, and IT Glue checklist imports are intentionally out of scope.

## Local development

Requirements: Node.js 22, pnpm 11, and PostgreSQL 16.

```bash
cp .env.example .env.local
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Without `DATABASE_URL` and Entra settings, `pnpm dev` opens a safe in-memory design preview. Production refuses to open until Entra authentication is configured.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Development server |
| `pnpm build` | Production build |
| `pnpm db:generate` | Generate Drizzle SQL from the schema |
| `pnpm db:migrate` | Apply committed migrations |
| `pnpm db:seed` | Upsert approved variable mappings and starter template |
| `pnpm sync:itg` | Synchronize all enabled organizations, read-only |
| `pnpm test` | Unit tests |
| `pnpm typecheck` | Strict TypeScript check |
| `pnpm validate:northflank` | Validate resource nodes against Northflank’s live schemas |

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the secure Northflank and Entra bootstrap.
