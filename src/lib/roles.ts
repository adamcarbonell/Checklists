export type AppRole = "admin" | "editor" | "viewer";
const weight: Record<AppRole, number> = { viewer: 1, editor: 2, admin: 3 };
export function roleAllows(role: AppRole, minimum: AppRole) { return weight[role] >= weight[minimum]; }
