"use client";

import { useEffect, useState } from "react";

import { ApiError, getActivity, type AuditEvent, type Column } from "@/lib/api";
import { initials, timeAgo } from "@/lib/format";

const ACTION_TEXT: Record<string, string> = {
  BOARD_CREATED: "created this board",
  BOARD_UPDATED: "updated the board description",
  COLUMN_CREATED: "added a column",
  COLUMN_UPDATED: "renamed a column",
  COLUMN_DELETED: "deleted a column",
  TASK_CREATED: "added a task",
  TASK_UPDATED: "updated a task",
  TASK_DELETED: "deleted a task",
  TASK_MOVED: "moved a task",
  COMMENT_ADDED: "commented on a task",
  COMMENT_DELETED: "deleted a comment",
  MEMBER_ADDED: "invited someone to the board",
  MEMBER_ROLE_CHANGED: "changed a member's role",
  MEMBER_REMOVED: "removed a member",
};

function describeEvent(event: AuditEvent, columns: Column[]): string {
  const metadata = event.metadata ?? {};
  const columnNames = new Map(columns.map((column) => [column.id, column.title]));
  const taskTitles = new Map<string, string>();
  for (const column of columns) {
    for (const task of column.tasks) {
      taskTitles.set(task.id, task.title);
    }
  }
  const taskTitle = (id?: unknown) => {
    const title = typeof id === "string" ? taskTitles.get(id) : undefined;
    return title ? ` “${title}”` : "";
  };
  const colName = (id?: unknown) =>
    typeof id === "string" ? (columnNames.get(id) ?? "another column") : "another column";

  switch (event.action) {
    case "TASK_MOVED":
      return `moved${taskTitle(event.entityId)} from ${colName(metadata.fromColumn)} to ${colName(metadata.toColumn)}`;
    case "TASK_CREATED":
      return `added task${taskTitle(event.entityId)}`;
    case "TASK_UPDATED":
      return `updated task${taskTitle(event.entityId)}`;
    case "TASK_DELETED":
      return `deleted a task${taskTitle(event.entityId)}`;
    case "COMMENT_ADDED":
      return `commented on task${taskTitle(metadata.taskId)}`;
    case "COMMENT_DELETED":
      return "deleted a comment";
    case "MEMBER_ADDED":
      return `invited ${typeof metadata.email === "string" ? metadata.email : "a member"}`;
    case "MEMBER_ROLE_CHANGED":
      return `changed ${typeof metadata.email === "string" ? metadata.email : "a member"}'s role`;
    case "MEMBER_REMOVED":
      return `removed ${typeof metadata.email === "string" ? metadata.email : "a member"}`;
    case "COLUMN_CREATED":
      return `added column ${typeof metadata.title === "string" ? `“${metadata.title}”` : ""}`;
    case "COLUMN_UPDATED":
      return `renamed a column${typeof metadata.title === "string" ? ` to “${metadata.title}”` : ""}`;
    case "COLUMN_DELETED":
      return `deleted column${typeof metadata.title === "string" ? ` “${metadata.title}”` : ""}`;
    default:
      return ACTION_TEXT[event.action] ?? event.action.toLowerCase().replaceAll("_", " ");
  }
}

export function ActivityPanel({
  boardId,
  columns,
  onClose,
}: {
  boardId: string;
  columns: Column[];
  onClose(): void;
}) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    // Initial fetch: state updates happen only after the awaited request.
    void getActivity(boardId, { limit: 50 })
      .then((page) => {
        setEvents(page.events);
        setNextCursor(page.nextCursor);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "Could not load activity");
      })
      .finally(() => setLoading(false));
  }, [boardId]);

  async function loadOlder() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await getActivity(boardId, { limit: 50, cursor: nextCursor });
      setEvents((current) => [...current, ...page.events]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load older activity");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-slate-900/30"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Activity</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close activity"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </header>

        {error ? (
          <p className="border-b border-red-100 bg-red-50 px-5 py-2 text-sm text-red-700">{error}</p>
        ) : null}

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="text-sm text-slate-400">Loading activity…</p>
          ) : events.length === 0 ? (
            <p className="text-sm text-slate-400">No activity yet.</p>
          ) : (
            <ol className="relative space-y-5 before:absolute before:inset-y-1 before:left-2.5 before:w-px before:bg-slate-200">
              {events.map((event) => (
                <li key={event.id} className="relative pl-8">
                  <span className="absolute left-0 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-[9px] font-semibold text-indigo-700 ring-4 ring-white">
                    {initials(event.actor.name)}
                  </span>
                  <p className="text-sm leading-snug text-slate-700">
                    <span className="font-semibold text-slate-900">{event.actor.name}</span>{" "}
                    {describeEvent(event, columns)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400">{timeAgo(event.createdAt)}</p>
                </li>
              ))}
            </ol>
          )}
        </div>

        {nextCursor ? (
          <footer className="border-t border-slate-200 p-3">
            <button
              type="button"
              onClick={() => void loadOlder()}
              disabled={loadingMore}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : "Load older activity"}
            </button>
          </footer>
        ) : null}
      </aside>
    </div>
  );
}