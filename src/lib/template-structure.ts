import type { DatabaseTransaction } from "@/db/client";
import { loadWorkspace } from "./workspace-data";
import { buildTemplateTree, workspaceItems } from "./conditional-tree";
import { OrderError } from "./template-order";

export async function assertTemplateStructure(tx: DatabaseTransaction, templateId: string, touched: string[] = []) {
  const workspace = await loadWorkspace(templateId, tx);
  if (!workspace) throw new OrderError("template_not_found", 404);
  const tree = buildTemplateTree(workspaceItems(workspace.steps, workspace.organizationId ?? ""), workspace.branches ?? [], workspace.organizationId ?? "");
  const error = tree.issues.find((issue) => issue.code !== "missing_anchor" || touched.includes(issue.itemId));
  if (error) throw new OrderError(error.code, 409);
  return workspace;
}
