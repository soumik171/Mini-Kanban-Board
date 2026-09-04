"use client";

import { useEffect, useState, type FormEvent } from "react";

import {
  ApiError,
  deleteTask,
  listMembers,
  updateTask,
  type Member,
  type Priority,
  type Task,
} from "@/lib/api";
import { PRIORITY_ORDER, PRIORITY_STYLES, initials } from "@/lib/format";

export function TaskDialog({
  boardId,
  task,
  canEdit,
  onSaved,
  onDeleted,
  onClose,
}: {
  boardId: string;
  task: Task;
  canEdit: boolean;
  onSaved(): void;
  onDeleted(): void;
  onClose(): void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [dueDate, setDueDate] = useState(task.dueDate ? task.dueDate.slice(0, 10) : "");
  const [labels, setLabels] = useState(task.labels.join(", "));
  const [assigneeId, setAssigneeId] = useState(task.assignee?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    void listMembers(boardId)
      .then(setMembers)
      .catch(() => setMembers([]));
  }, [boardId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Title is required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateTask(boardId, task.id, {
        title: trimmedTitle,
        description: description.trim() || null,
        priority,
        // The date input yields "YYYY-MM-DD"; the API requires a full
        // ISO 8601 datetime (z.string().datetime({ offset: true })).
        dueDate: dueDate ? `${dueDate}T00:00:00.000Z` : null,
        labels: labels
          .split(",")
          .map((label) => label.trim())
          .filter(Boolean),
        assigneeId: assigneeId || null,
      });
      // Close on success so the board behind shows the saved values.
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save task");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    // Two-step confirm: the first click arms the delete, the second runs it.
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteTask(boardId, task.id);
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete task");
      setConfirmingDelete(false);
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-xl">
        <form onSubmit={handleSave} className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            {canEdit ? (
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Task title"
                maxLength={200}
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-base font-semibold text-slate-900 outline-none focus:border-indigo-500"
              />
            ) : (
              <h2 className="text-lg font-semibold text-slate-900">{task.title}</h2>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
              </svg>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {PRIORITY_ORDER.map((value) => {
              const selected = priority === value;
              return (
                <button
                  key={value}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => setPriority(value)}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase transition ${
                    selected
                      ? PRIORITY_STYLES[value] + " ring-2 ring-indigo-500/60"
                      : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                  } ${canEdit ? "" : "cursor-default"}`}
                >
                  {value}
                </button>
              );
            })}
          </div>

          {canEdit ? (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Description</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Add a description…"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
              />
            </label>
          ) : task.description ? (
            <div>
              <span className="mb-1 block text-xs font-medium text-slate-500">Description</span>
              <p className="whitespace-pre-wrap text-sm text-slate-700">{task.description}</p>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Due date</span>
              <input
                type="date"
                value={dueDate}
                disabled={!canEdit}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 disabled:bg-slate-50 disabled:text-slate-500"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Assignee</span>
              {canEdit ? (
                <select
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                >
                  <option value="">Unassigned</option>
                  {members.map((member) => (
                    <option key={member.user.id} value={member.user.id}>
                      {member.user.name} ({member.role})
                    </option>
                  ))}
                </select>
              ) : task.assignee ? (
                <span className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-[9px] font-semibold text-indigo-700">
                    {initials(task.assignee.name)}
                  </span>
                  {task.assignee.name}
                </span>
              ) : (
                <span className="block rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-400">
                  Unassigned
                </span>
              )}
            </label>
          </div>

          {canEdit ? (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">
                Labels <span className="font-normal text-slate-400">(comma-separated)</span>
              </span>
              <input
                type="text"
                value={labels}
                onChange={(e) => setLabels(e.target.value)}
                placeholder="backend, frontend, bug…"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
              />
            </label>
          ) : task.labels.length > 0 ? (
            <div>
              <span className="mb-1 block text-xs font-medium text-slate-500">Labels</span>
              <div className="flex flex-wrap gap-1">
                {task.labels.map((label) => (
                  <span
                    key={label}
                    className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          ) : null}

          <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-4">
            {canEdit ? (
              confirmingDelete ? (
                <span className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-red-600">
                    {`Delete \u201C${task.title.length > 40 ? `${task.title.slice(0, 40)}…` : task.title}\u201D?`}
                  </span>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={busy}
                    className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(false)}
                    className="rounded-lg px-2 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100"
                  >
                    Keep
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={handleDelete}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
                >
                  Delete
                </button>
              )
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              {canEdit ? (
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Save"}
                </button>
              ) : null}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}