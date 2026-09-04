"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { AppHeader } from "@/components/app-header";
import { RequireAuth } from "@/components/require-auth";
import {
  ApiError,
  createColumn,
  createTask,
  getBoard,
  listColumns,
  type BoardRole,
  type BoardSummary,
  type Column,
  type Task,
} from "@/lib/api";
import {
  PRIORITY_STYLES,
  ROLE_STYLES,
  formatDueDate,
  initials,
  isOverdue,
} from "@/lib/format";

interface BoardState {
  board: BoardSummary;
  role: BoardRole;
}

export default function BoardPage() {
  return (
    <RequireAuth>
      <AppHeader />
      <BoardContent />
    </RequireAuth>
  );
}

function BoardContent() {
  const { boardId } = useParams<{ boardId: string }>();
  const [detail, setDetail] = useState<BoardState | null>(null);
  const [columns, setColumns] = useState<Column[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!boardId) return;
    try {
      const [boardDetail, cols] = await Promise.all([getBoard(boardId), listColumns(boardId)]);
      setDetail(boardDetail);
      setColumns(cols);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load board");
    } finally {
      setLoading(false);
    }
  }, [boardId]);

  useEffect(() => {
    // Initial fetch: state updates happen only after the awaited request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (loading) {
    return (
      <main className="flex flex-1 items-center justify-center text-sm text-slate-500">
        Loading board…
      </main>
    );
  }

  if (!detail || error) {
    return (
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-16 sm:px-6">
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error ?? "Board not found"}
        </p>
        <Link href="/" className="mt-4 inline-block text-sm font-medium text-indigo-600 hover:underline">
          ← Back to boards
        </Link>
      </main>
    );
  }

  const canEdit = detail.role === "OWNER" || detail.role === "EDITOR";

  return (
    <main className="flex flex-1 flex-col">
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <Link href="/" className="text-sm text-slate-500 hover:text-indigo-600 hover:underline">
              ← Boards
            </Link>
            <div className="mt-1 flex items-center gap-3">
              <h1 className="truncate text-xl font-semibold text-slate-900">{detail.board.title}</h1>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_STYLES[detail.role]}`}
              >
                {detail.role}
              </span>
            </div>
            {detail.board.description ? (
              <p className="mt-1 text-sm text-slate-500">{detail.board.description}</p>
            ) : null}
          </div>
          <p className="text-xs text-slate-400">
            Owned by {detail.board.owner.name}
          </p>
        </div>
      </div>

      <BoardColumnRow
        boardId={boardId ?? ""}
        columns={columns}
        canEdit={canEdit}
        onChanged={() => void load()}
      />
    </main>
  );
}

function BoardColumnRow({
  boardId,
  columns,
  canEdit,
  onChanged,
}: {
  boardId: string;
  columns: Column[];
  canEdit: boolean;
  onChanged(): void;
}) {
  const [addingColumn, setAddingColumn] = useState(false);
  const [columnTitle, setColumnTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAddColumn(event: FormEvent) {
    event.preventDefault();
    const title = columnTitle.trim();
    if (!title || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createColumn(boardId, title);
      setColumnTitle("");
      setAddingColumn(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add column");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 overflow-x-auto px-4 py-6 sm:px-6">
      <div className="flex h-full items-start gap-4">
        {columns.map((column) => (
          <ColumnCard
            key={column.id}
            boardId={boardId}
            column={column}
            canEdit={canEdit}
            onChanged={onChanged}
          />
        ))}

        {canEdit ? (
          <div className="w-72 shrink-0">
            {addingColumn ? (
              <form onSubmit={handleAddColumn} className="space-y-2 rounded-xl bg-white p-3 shadow-sm">
                <input
                  type="text"
                  autoFocus
                  value={columnTitle}
                  onChange={(e) => setColumnTitle(e.target.value)}
                  placeholder="Column title…"
                  maxLength={120}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                />
                {error ? <p className="text-xs text-red-600">{error}</p> : null}
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={busy || !columnTitle.trim()}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddingColumn(false)}
                    className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setAddingColumn(true)}
                className="w-full rounded-xl border-2 border-dashed border-slate-300 px-3 py-3 text-sm font-medium text-slate-500 transition hover:border-indigo-400 hover:text-indigo-600"
              >
                + Add column
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ColumnCard({
  boardId,
  column,
  canEdit,
  onChanged,
}: {
  boardId: string;
  column: Column;
  canEdit: boolean;
  onChanged(): void;
}) {
  const [taskTitle, setTaskTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAddTask(event: FormEvent) {
    event.preventDefault();
    const title = taskTitle.trim();
    if (!title || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createTask(boardId, column.id, { title });
      setTaskTitle("");
      setAdding(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add task");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex max-h-full w-72 shrink-0 flex-col rounded-xl bg-slate-200/70">
      <header className="flex items-center justify-between px-3 pb-1 pt-3">
        <h3 className="text-sm font-semibold text-slate-700">{column.title}</h3>
        <span className="text-xs font-medium text-slate-400">{column.tasks.length}</span>
      </header>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {column.tasks.length === 0 && !adding ? (
          <p className="px-2 py-4 text-center text-xs text-slate-400">No tasks yet</p>
        ) : null}
        {column.tasks.map((task) => (
          <TaskCard key={task.id} task={task} />
        ))}

        {canEdit && adding ? (
          <form onSubmit={handleAddTask} className="space-y-2 rounded-lg bg-white p-2 shadow-sm">
            <input
              type="text"
              autoFocus
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              placeholder="Task title…"
              maxLength={200}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-indigo-500"
            />
            {error ? <p className="text-xs text-red-600">{error}</p> : null}
            <div className="flex gap-1.5">
              <button
                type="submit"
                disabled={busy || !taskTitle.trim()}
                className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}

        {canEdit && !adding ? (
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              setError(null);
            }}
            className="rounded-lg px-2 py-1.5 text-left text-sm text-slate-500 transition hover:bg-slate-300/50 hover:text-indigo-600"
          >
            + Add task
          </button>
        ) : null}
      </div>
    </section>
  );
}

function TaskCard({ task }: { task: Task }) {
  return (
    <article className="group rounded-lg bg-white p-3 shadow-sm transition hover:shadow">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-medium leading-snug text-slate-800">{task.title}</h4>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${PRIORITY_STYLES[task.priority]}`}
        >
          {task.priority}
        </span>
      </div>

      {task.labels.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.labels.map((label) => (
            <span
              key={label}
              className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
            >
              {label}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {task.dueDate ? (
            <span
              className={`text-[10px] font-medium ${
                isOverdue(task.dueDate) ? "text-red-600" : "text-slate-500"
              }`}
            >
              {isOverdue(task.dueDate) ? "Overdue " : ""}
              {formatDueDate(task.dueDate)}
            </span>
          ) : null}
        </div>
        {task.assignee ? (
          <span
            title={task.assignee.name}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-[9px] font-semibold text-indigo-700"
          >
            {initials(task.assignee.name)}
          </span>
        ) : null}
      </div>
    </article>
  );
}
