import { Modal } from "./workspace-ui";

export function ChecklistDeleteDialog({
  count, busy, error, onClose, onConfirm,
}: {
  count: number;
  busy: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const title = count === 1
    ? "Are you sure you want to delete this checklist?"
    : `Are you sure you want to delete these ${count} checklists?`;
  return (
    <Modal title={title} onClose={onClose}>
      {error && <p role="alert" className="mb-4 text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" disabled={busy} onClick={onClose} className="rounded-xl border px-4 py-2 text-sm">
          Cancel
        </button>
        <button type="button" disabled={busy} onClick={onConfirm} className="rounded-xl bg-red-700 px-4 py-2 text-sm text-white disabled:opacity-40">
          {busy ? "Deleting…" : count === 1 ? "Delete checklist" : "Delete checklists"}
        </button>
      </div>
    </Modal>
  );
}
