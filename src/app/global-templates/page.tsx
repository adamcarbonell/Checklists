import { signedInPage } from "@/lib/page-access";
import { hasDatabase } from "@/db/client";
import { loadTemplates } from "@/lib/workspace-data";
import { TemplateCatalog } from "@/components/template-catalog";
export const dynamic = "force-dynamic";
export default async function GlobalTemplates() {
  const user = await signedInPage("/global-templates"),
    rows = hasDatabase()
      ? await loadTemplates({ scope: "global", includeDeleted: true })
      : [];
  return (
    <TemplateCatalog
      initial={rows}
      globals={rows.filter((row) => !row.deletedAt)}
      user={user}
    />
  );
}
