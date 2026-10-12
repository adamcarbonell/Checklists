"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BookOpenCheck,
  ListChecks,
  Layers3,
  AppWindow,
  Variable,
  Users,
  Clock3,
  Settings2,
  Menu as MenuIcon,
  MoreHorizontal,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import type {
  WorkspaceUser,
  VariableDefinitionSummary,
} from "@/lib/workspace-types";
import { SaveQueue } from "@/lib/save-queue";

export const doc = (text: string) => ({
  type: "doc",
  content: [
    { type: "paragraph", content: text ? [{ type: "text", text }] : [] },
  ],
});
export class MutationGate {
  private active = false;
  enter() {
    if (this.active) return false;
    this.active = true;
    return true;
  }
  leave() {
    this.active = false;
  }
}
export const textOf = (
  node: import("@/lib/template-engine").RichNode,
): string =>
  [node.text, ...(node.content ?? []).map(textOf)].filter(Boolean).join(" ");
export async function api(url: string, method = "GET", body?: unknown) {
  const response = await fetch(url, {
    method,
    cache: "no-store",
    ...(body !== undefined
      ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    const messages: Record<string, string> = {
      order_changed_reload:
        "The step order changed in another session. Reload before trying again.",
      order_membership_changed:
        "Steps were added or removed after this revision. Restore their membership before restoring this order.",
      invalid_anchor:
        "Choose an active global step as the organization step’s anchor.",
      invalid_restored_anchor:
        "This order revision refers to an unavailable anchor.",
      step_is_referenced:
        "This global step is still used by a template. Remove its references before deleting it.",
      repeat_variable_must_be_active_list:
        "Repetition requires an active list variable.",
      invalid_request_body: "Check the required fields before saving.",
      request_failed: "The request could not be completed. Try again.",
      forbidden: "Your role does not allow this action.",
      unauthorized: "Your session expired. Sign in again.",
    };
    throw new Error(
      messages[result.error] ??
        "The request could not be completed. Reload and try again.",
    );
  }
  return response.status === 204 ? null : response.json();
}
export function useSaves() {
  const [state, setState] = useState<"saved" | "saving" | "error">("saved");
  const [queue] = useState(
    () =>
      new SaveQueue(async (url, body) => {
        await api(url, "PATCH", body);
      }, setState),
  );
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (queue.hasPending()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => {
      queue.dispose();
      window.removeEventListener("beforeunload", handler);
    };
  }, [queue]);
  return { state, queue };
}
export function WorkspaceShell({
  user,
  active,
  counts = {},
  beforeNavigate,
  children,
}: {
  user: WorkspaceUser;
  active: "templates" | "library";
  counts?: Record<string, number>;
  beforeNavigate?: () => Promise<void>;
  children: ReactNode;
}) {
  const [mobile, setMobile] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const links = [
    { key: "templates", label: "Templates", href: "/", icon: ListChecks },
    {
      key: "library",
      label: "Global library",
      href: "/global-library",
      icon: Layers3,
    },
    ...(user.role === "admin"
      ? [
          {
            key: "organizations",
            label: "Organizations",
            href: "/admin/organizations",
            icon: AppWindow,
          },
          {
            key: "variables",
            label: "Variables",
            href: "/admin/variables",
            icon: Variable,
          },
          { key: "users", label: "Users", href: "/admin/users", icon: Users },
          {
            key: "history",
            label: "History",
            href: "/admin/history",
            icon: Clock3,
          },
        ]
      : []),
  ];
  return (
    <div className="min-h-screen bg-[#f3f6f3] lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <button
        aria-label="Open navigation"
        className="fixed bottom-4 left-4 z-30 rounded-xl bg-[#102d2a] p-3 text-white lg:hidden"
        onClick={() => setMobile(!mobile)}
      >
        <MenuIcon size={20} />
      </button>
      <aside
        className={`${mobile ? "fixed inset-y-0 left-0 z-40 flex w-[248px]" : "hidden"} min-h-screen flex-col border-r border-[#d9e2dc] bg-[#102d2a] text-white lg:sticky lg:top-0 lg:flex lg:h-screen`}
      >
        <div className="flex h-[76px] shrink-0 items-center gap-3 border-b border-white/10 px-5">
          <div className="grid size-9 place-items-center rounded-xl bg-[#b7e454] text-[#17322e]">
            <BookOpenCheck size={20} />
          </div>
          <div>
            <div className="font-semibold">Checklists</div>
            <div className="text-[11px] text-white/50">Version2 workspace</div>
          </div>
          {mobile && (
            <button
              aria-label="Close navigation"
              onClick={() => setMobile(false)}
            >
              <X size={16} />
            </button>
          )}
        </div>
        <nav className="flex-1 space-y-1 px-3 py-5">
          <div className="mb-2 px-3 text-[10px] uppercase tracking-widest text-white/40">
            Workspace
          </div>
          {links.map(({ key, label, href, icon: Icon }) => (
            <a
              key={key}
              href={href}
              aria-current={key === active ? "page" : undefined}
              onClick={(event) => {
                if (beforeNavigate) {
                  event.preventDefault();
                  void beforeNavigate()
                    .then(() => router.push(href))
                    .catch(() =>
                      setError("Save failed. Retry before leaving."),
                    );
                }
              }}
              className={`focus-ring flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] ${key === active ? "bg-white/12" : "text-white/65 hover:bg-white/10"}`}
            >
              <Icon size={17} />
              <span className="flex-1">{label}</span>
              {counts[key] !== undefined && (
                <span className="text-[10px] text-white/45">{counts[key]}</span>
              )}
            </a>
          ))}
        </nav>
        {error && (
          <p role="alert" className="p-3 text-xs text-amber-200">
            {error}
          </p>
        )}
        <div className="m-3 rounded-xl border border-white/10 p-3 text-xs text-white/55">
          Organization sync status is available in Variables and Validation.
        </div>
        <div className="flex items-center gap-3 border-t border-white/10 p-4">
          <div className="grid size-9 place-items-center rounded-full bg-[#2d5b54] text-xs font-bold">
            {(user.name || user.email)
              .split(/[ @]/)
              .map((p) => p[0])
              .slice(0, 2)
              .join("")
              .toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold">
              {user.name || user.email}
            </div>
            <div className="text-[10px] capitalize text-white/50">
              {user.role}
            </div>
          </div>
          <ActionMenu
            label="Account"
            placement="up"
            icon={<Settings2 size={16} />}
            actions={[
              { label: user.email, disabled: true },
              { label: `Role: ${user.role}`, disabled: true },
              {
                label: "Sign out",
                onClick: async () => {
                  await beforeNavigate?.();
                  await signOut({ redirectTo: "/" });
                },
              },
            ]}
          />
        </div>
      </aside>
      <main className="min-w-0">{children}</main>
    </div>
  );
}
export type MenuAction = {
  label: string;
  onClick?: () => void | Promise<void>;
  disabled?: boolean;
  danger?: boolean;
};
export function ActionMenu({
  label,
  actions,
  icon = <MoreHorizontal size={18} />,
  placement = "down",
}: {
  label: string;
  actions: MenuAction[];
  icon?: ReactNode;
  placement?: "up" | "down";
}) {
  const [open, setOpen] = useState(false),
    [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    root.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
      ?.focus();
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return (
    <div
      ref={root}
      className="relative inline-block"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setOpen(false);
          trigger.current?.focus();
        }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key) && open) {
          e.preventDefault();
          const items = Array.from(
            root.current!.querySelectorAll<HTMLButtonElement>(
              '[role="menuitem"]:not(:disabled)',
            ),
          );
          const i = items.indexOf(document.activeElement as HTMLButtonElement);
          items[
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? items.length - 1
                : (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
                  items.length
          ]?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(!open)}
        className="focus-ring rounded-lg p-2 hover:bg-slate-100/20"
      >
        {icon}
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className={`absolute right-0 z-30 min-w-52 rounded-xl border border-slate-200 bg-white p-1 text-slate-800 shadow-xl ${placement === "up" ? "bottom-full mb-2" : "top-full mt-1"}`}
        >
          {actions.map((a) => (
            <button
              key={a.label}
              role="menuitem"
              disabled={a.disabled}
              className={`block w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-slate-50 disabled:opacity-45 ${a.danger ? "text-red-700" : ""}`}
              onClick={() => {
                setOpen(false);
                setError("");
                Promise.resolve(a.onClick?.()).catch((e) =>
                  setError(e.message),
                );
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
      {error && (
        <span
          role="alert"
          className="absolute right-0 z-30 w-56 rounded-lg bg-red-50 p-3 text-xs text-red-800"
        >
          {error}
        </span>
      )}
    </div>
  );
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={onClose}
      className="max-h-[90vh] w-[min(92vw,760px)] rounded-2xl border border-slate-200 bg-[#fffef9] p-0 shadow-2xl backdrop:bg-[#102d2a]/55"
    >
      <div className="flex items-center justify-between border-b p-5">
        <h2 className="font-semibold">{title}</h2>
        <button
          aria-label="Close dialog"
          onClick={onClose}
          className="focus-ring rounded-lg p-2"
        >
          <X size={18} />
        </button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  );
}
export function TextPrompt({
  title,
  label,
  initialValue = "",
  submitLabel = "Save",
  required = true,
  maxLength = 200,
  suggestions = [],
  errorMessage = "",
  onClose,
  onSubmit,
}: {
  title: string;
  label: string;
  initialValue?: string;
  submitLabel?: string;
  required?: boolean;
  maxLength?: number;
  suggestions?: string[];
  errorMessage?: string;
  onClose: () => void;
  onSubmit: (value: string) => void | Promise<void>;
}) {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault();
          const text = value.trim();
          if (saving || (required && !text)) return;
          setSaving(true);
          setError("");
          try {
            await onSubmit(text);
          } catch {
            setError("Unable to save. Please check the value and retry.");
          } finally {
            setSaving(false);
          }
        }}
      >
        <label className="block text-sm">
          {label}
          <input
            autoFocus
            required={required}
            maxLength={maxLength}
            value={value}
            disabled={saving}
            list={suggestions.length ? "prompt-suggestions" : undefined}
            onChange={(event) => setValue(event.target.value)}
            className="mt-2 w-full rounded-lg border p-3"
          />
        </label>
        {suggestions.length > 0 && (
          <datalist id="prompt-suggestions">
            {suggestions.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
        )}
        {(error || errorMessage) && (
          <p role="alert" className="text-sm text-red-700">
            {error || errorMessage}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="rounded-lg border px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            disabled={saving || (required && !value.trim())}
            className="rounded-lg bg-teal-700 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function RepeatControl({
  value,
  definitions,
  disabled,
  onChange,
}: {
  value: string | null;
  definitions: VariableDefinitionSummary[];
  disabled?: boolean;
  onChange: (id: string | null) => void;
}) {
  const available = definitions.filter(
    (d) => d.enabled && d.cardinality === "list",
  );
  const [choosing, setChoosing] = useState(false);
  return (
    <fieldset
      disabled={disabled}
      className="rounded-xl border border-[#d8e1dc] p-3"
    >
      <label className="flex gap-3 text-xs">
        <input
          type="checkbox"
          checked={!!value || choosing}
          onChange={(e) => {
            if (!e.target.checked) {
              setChoosing(false);
              onChange(null);
            } else setChoosing(true);
          }}
        />
        Repeat for a list variable
      </label>
      {(value || choosing) && (
        <select
          aria-label="Repeat list variable"
          value={value ?? ""}
          onChange={(e) => {
            if (e.target.value) {
              onChange(e.target.value);
              setChoosing(false);
            }
          }}
          className="mt-3 w-full rounded-lg border p-2 text-xs"
        >
          <option value="">Choose a list variable</option>
          {value && !available.some((d) => d.id === value) && (
            <option value={value}>Unavailable list variable</option>
          )}
          {available.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label} ({d.key})
            </option>
          ))}
        </select>
      )}
      {choosing && !value && (
        <p className="mt-2 text-xs text-amber-800">
          Select a list to enable repetition.
        </p>
      )}
      {!available.length && (
        <p className="mt-2 text-xs text-slate-500">
          No active list variables configured.
        </p>
      )}
    </fieldset>
  );
}
export function HistoryDialog({
  entities,
  canEdit,
  onClose,
  onRestored,
}: {
  entities: { type: string; id: string }[];
  canEdit: boolean;
  onClose: () => void;
  onRestored: () => Promise<void>;
}) {
  const [rows, setRows] = useState<
      {
        id: string;
        entityType: string;
        action: string;
        createdAt: string;
        snapshot: Record<string, unknown>;
      }[]
    >([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    void Promise.all(
      entities.map((e) =>
        api(`/api/revisions?entityType=${e.type}&entityId=${e.id}`),
      ),
    )
      .then((results) => {
        if (alive)
          setRows(
            results
              .flatMap((r) => r.data)
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
          );
      })
      .catch(() => setError("History could not be loaded."));
    return () => {
      alive = false;
    };
  }, [entities]);
  return (
    <Modal title="Version history" onClose={onClose}>
      {error && (
        <p role="alert" className="mb-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {!rows.length && (
        <p className="text-sm text-slate-500">No revisions available.</p>
      )}
      <div className="space-y-3">
        {rows.map((row) => (
          <div key={row.id} className="rounded-xl border bg-white p-3">
            <div className="flex justify-between gap-3">
              <div>
                <p className="text-xs font-semibold">
                  {row.entityType.replaceAll("_", " ")} · {row.action}
                </p>
                <time className="text-xs text-slate-500">
                  {new Date(row.createdAt).toLocaleString()}
                </time>
              </div>
              {canEdit && (
                <button
                  disabled={busy}
                  className="rounded-lg border px-3 text-xs disabled:opacity-50"
                  onClick={async () => {
                    if (
                      !window.confirm(
                        "Restore this revision? The current state will be recorded in history.",
                      )
                    )
                      return;
                    setBusy(true);
                    try {
                      await api(`/api/revisions/${row.id}/restore`, "POST");
                      await onRestored();
                      onClose();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Restore
                </button>
              )}
            </div>
            <p className="mt-2 text-sm">
              {String(
                row.snapshot.title ??
                  row.snapshot.snapshotTitle ??
                  row.snapshot.name ??
                  "Template order",
              )}
            </p>
          </div>
        ))}
      </div>
    </Modal>
  );
}
