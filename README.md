# Checklists

Private, organization-aware template authoring and shared checklist execution for Version2.

## How it works

1. Editors maintain **Global templates**, each with its own standard steps.
2. Inside an **Organization**, editors link a global template and add local, client-only steps. Inherited steps update automatically and cannot be edited in the organization template.
3. Any enabled, signed-in user—including a viewer—starts a **Checklist** from an organization template. Instructions, variables, ordering, and repeated steps are frozen at creation.
4. Team members complete or skip steps, add notes, and reopen work. An append-only activity history records changes. There are no assignments.

Local steps belong to one organization template and are never placed in a reusable library. Removing an inherited anchor leaves its local additions visibly unplaced and blocks new checklists until repaired.

### Application fields in repeated steps

Enable **Repeat for a list variable** and select **Applications**. In that step's title or instructions, use `{{org.applications.name}}` (or the equivalent `{{item.name}}`). Each rendered step receives the current application's field, not the entire list. The editor's **Variable** picker lists the approved fields for the selected repeat list.

For version information, an administrator first adds its exact IT Glue field key under **Variables → Applications → Add approved field**, using the lowercase alias `version` and the correct expected kind. Save the mapping, validate the saved schema, and sync the organization. Then use `{{org.applications.version}}` or `{{item.version}}`. Aliases are case-sensitive: `Version` and `version` are different. The built-in source key `name` refers to the asset display name, not a separate Name trait. If the actual trait's key is `name`, explicitly map `traits.name` to select it instead; existing display-name mappings are not changed automatically.

Only explicitly approved fields are retained and exposed. New fields are not enabled by this release; no existing mapping is overwritten. List-field tokens outside a step repeating that list, missing fields, invalid schemas, and stale values block new checklist creation. Existing runnable checklists remain frozen.

## Included

- Next.js 16, TypeScript, PostgreSQL, Drizzle, Auth.js, Microsoft Entra ID, and TipTap.
- Live template inheritance, rich-text instructions, repetition, autosave, atomic ordering, revisions, and soft-delete recovery.
- Approved, normalized IT Glue organization variables; freshness and validation checks shared by preview and checklist creation.
- Atomic, idempotent frozen checklist creation; version-checked progress; required skip reasons; plain-text notes; separate completed/skipped counts.
- Admin/editor/viewer template permissions, with checklist execution available to all enabled tenant users.
- Read-only IT Glue synchronization every six hours, bounded retries, and a 1,000-record ceiling.
- Production Docker image, health endpoints, and a migration-first, build-pinned Northflank release flow.

Assignments, due dates, notifications, attachments, ticket integrations, IT Glue writes, and imports are outside this version.

## Development

Requirements: Node.js 22, pnpm 11, PostgreSQL 16. Enter development secrets only in a local, ignored environment file; never in chat or Git. See `.env.example` for variable names.

```sh
pnpm install
# For a fresh or isolated development database only:
pnpm db:migrate --confirm-template-reset
pnpm db:seed
pnpm dev
```

The redesign migration permanently removes legacy templates, libraries, and their revisions. It requires the explicit reset flag on its first application, including in a fresh database. Do not run it against an existing deployment until the [cutover procedure](docs/DEPLOYMENT.md) is authorized and web writes are paused.

Without a database, local development shows explicit empty/unavailable states, not demo organizations or successful validation. Production requires Entra authentication. Seeding creates only missing default variable definitions; it never overwrites existing mappings or creates templates.

## Commands

| Command                        | Purpose                                                        |
| ------------------------------ | -------------------------------------------------------------- |
| `pnpm dev`                     | Development server                                             |
| `pnpm build`                   | Production build                                               |
| `pnpm lint` / `pnpm typecheck` | Static checks                                                  |
| `pnpm test`                    | Unit, interface, and isolated-database integration tests       |
| `pnpm db:generate`             | Generate Drizzle SQL                                           |
| `pnpm db:migrate`              | Apply migrations; pending destructive reset needs confirmation |
| `pnpm db:seed`                 | Insert missing default IT Glue mappings, without overwriting   |
| `pnpm sync:itg`                | Read-only synchronization of enabled organizations             |
| `pnpm validate:northflank`     | Check resource nodes against public Northflank schemas         |

See [architecture](docs/ARCHITECTURE.md) and [deployment/cutover](docs/DEPLOYMENT.md).
