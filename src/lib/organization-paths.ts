export function organizationPath(id: string, folderId?: string | null) {
  return folderId ? `/organizations/${id}/folders/${folderId}` : `/organizations/${id}`;
}

export function checklistPath(organizationId: string, checklistId: string) {
  return `${organizationPath(organizationId)}/checklists/${checklistId}`;
}
