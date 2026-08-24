"use client";

import { useState } from "react";

type UserRow = { id: string; email: string; name: string | null; role: "admin" | "editor" | "viewer"; disabled: boolean; lastSeenAt: Date | string | null };

export function UserRoleManager({ initial }: { initial: UserRow[] }) {
  const [users, setUsers] = useState(initial);
  const update = async (id: string, input: Partial<Pick<UserRow, "role" | "disabled">>) => {
    const response = await fetch(`/api/users/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
    if (response.ok) { const result = await response.json(); setUsers((rows) => rows.map((row) => row.id === id ? { ...row, ...result.data } : row)); }
  };
  return <section className="overflow-hidden rounded-2xl border border-[#d9e2dc] bg-white">{users.map((user) => <div key={user.id} className="grid items-center gap-3 border-b border-[#edf1ee] px-5 py-4 last:border-0 md:grid-cols-[minmax(0,1fr)_150px_100px]"><div><div className="text-sm font-semibold">{user.name || user.email}</div><div className="mt-1 text-[11px] text-slate-400">{user.email} · {user.lastSeenAt ? `seen ${new Date(user.lastSeenAt).toLocaleString()}` : "not signed in yet"}</div></div><select value={user.role} onChange={(event) => update(user.id, { role: event.target.value as UserRow["role"] })} className="mapping-input mt-0"><option value="admin">Administrator</option><option value="editor">Editor</option><option value="viewer">Viewer</option></select><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={user.disabled} onChange={(event) => update(user.id, { disabled: event.target.checked })} /> Disabled</label></div>)}</section>;
}
