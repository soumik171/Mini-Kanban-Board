"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";

import { ActivityPanel } from "@/components/activity-panel";
import { AppHeader } from "@/components/app-header";
import { MembersPanel } from "@/components/members-panel";
import { RequireAuth } from "@/components/require-auth";
import { TaskDialog } from "@/components/task-dialog";
import {
  ApiError,
  createColumn,
  createTask,
  deleteColumn,
  getBoard,
  listColumns,
  moveTask,
  renameColumn,
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

interface DragInfo {
  taskId: string;
  fromColumnId: string;
}

interface HoverTarget {
  columnId: string;
  beforeTaskId: string | null;
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
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"activity" | "members" | null>(null);

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

  // Auto-dismiss transient action errors (e.g. a rejected move) after a few
  // seconds so a stale banner never lingers over a healthy board.
  useEffect(() => {
    if (!actionError) return;
    const timer = setTimeout(() => setActionError(null), 5000);
    return () => clearTimeout(timer);
  }, [actionError]);

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
          <div className="flex flex-col items-end gap-2">
            <p className="text-xs text-slate-400">Owned by {detail.board.owner.name}</p>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setPanel("members")}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600"
              >
                Members
              </button>
              <button
                type="button"
                onClick={() => setPanel("activity")}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600"
              >
                Activity
              </button>
            </div>
          </div>
        </div>
      </div>

      {actionError ? (
        <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">
          {actionError}
        </div>
      ) : null}

      <BoardColumnRow
        boardId={boardId ?? ""}
        columns={columns}
        canEdit={canEdit}
        onChanged={() => void load()}
        onColumnsChange={setColumns}
        onError={setActionError}
        onOpenTask={setSelectedTask}
      />

      {selectedTask ? (
        <TaskDialog
          boardId={boardId ?? ""}
          task={selectedTask}
          canEdit={canEdit}
          onSaved={() => {
            setSelectedTask(null);
            void load();
          }}
          onDeleted={() => {
            setSelectedTask(null);
            void load();
          }}
          onClose={() => setSelectedTask(null)}
        />
      ) : null}

      {panel === "activity" ? (
        <ActivityPanel
          boardId={boardId ?? ""}
          columns={columns}
          onClose={() => setPanel(null)}
        />
      ) : null}

      {panel === "members" ? (
        <MembersPanel
          boardId={boardId ?? ""}
          isOwner={detail.role === "OWNER"}
          onClose={() => setPanel(null)}
        />
      ) : null}
    </main>
  );
}

// --------------------------------------------------------------- columns ---

function BoardColumnRow({
  boardId,
  columns,
  canEdit,
  onChanged,
  onColumnsChange,
  onError,
  onOpenTask,
}: {
  boardId: string;
  columns: Column[];
  canEdit: boolean;
  onChanged(): void;
  onColumnsChange(columns: Column[]): void;
  onError(message: string): void;
  onOpenTask(task: Task): void;
}) {
  const [addingColumn, setAddingColumn] = useState(false);
  const [columnTitle, setColumnTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<DragInfo | null>(null);
  const [hover, setHover] = useState<HoverTarget | null>(null);

  // Latest columns for handlers that run after a re-render (see runMove).
  const columnsRef = useRef(columns);
  useEffect(() => {
    columnsRef.current = columns;
  });
  // Drop requests are serialized: if a move is still in flight, the next drop
  // is queued and processed after it settles. This keeps the optimistic board
  // from racing ahead of the server (which surfaced as
  // "beforeTaskId must be a task in the target column" 400s on quick drags).
  const moveInFlight = useRef(false);
  const queuedDrop = useRef<{ taskId: string; target: HoverTarget } | null>(null);

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

  function handleDrop(target: HoverTarget) {
    if (!dragging) return;
    const taskId = dragging.taskId;
    setDragging(null);
    setHover(null);
    if (moveInFlight.current) {
      queuedDrop.current = { taskId, target };
      return;
    }
    void runMove(taskId, target);
  }

  // Optimistic move: reorder locally, then reconcile with the server. On
  // success or failure the columns are re-fetched so the board always mirrors
  // the server (fresh data is authoritative; no stale snapshot restore).
  async function runMove(taskId: string, target: HoverTarget) {
    moveInFlight.current = true;
    const before = columnsRef.current;
    const next = applyMove(before, taskId, target.columnId, target.beforeTaskId);
    if (next !== before) {
      onColumnsChange(next);
    }
    let succeeded = false;
    try {
      await moveTask(boardId, taskId, {
        columnId: target.columnId,
        beforeTaskId: target.beforeTaskId,
      });
      succeeded = true;
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Could not move task");
    } finally {
      moveInFlight.current = false;
      void onChanged();
      const nextQueued = queuedDrop.current;
      queuedDrop.current = null;
      // Only a move that the server accepted can be the basis for a queued
      // follow-up drop; a rejected move is rolled back by the refetch above.
      if (nextQueued && succeeded) {
        void runMove(nextQueued.taskId, nextQueued.target);
      }
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
            dragging={dragging}
            hover={hover}
            onDragStart={(taskId, fromColumnId) => setDragging({ taskId, fromColumnId })}
            onDragEnd={() => {
              setDragging(null);
              setHover(null);
            }}
            onHover={(target) => setHover(target)}
            onDrop={handleDrop}
            onChanged={onChanged}
            onError={onError}
            onOpenTask={onOpenTask}
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

/** Reorder `taskId` into `columnId` just before `beforeTaskId` (null = end). */
function applyMove(
  columns: Column[],
  taskId: string,
  columnId: string,
  beforeTaskId: string | null,
): Column[] {
  let task: Task | null = null;
  let source: Column | null = null;
  for (const column of columns) {
    const found = column.tasks.find((candidate) => candidate.id === taskId);
    if (found) {
      task = found;
      source = column;
      break;
    }
  }
  if (!task || !source) return columns;

  const target = columns.find((column) => column.id === columnId);
  if (!target) return columns;

  const fromList = source.tasks.filter((candidate) => candidate.id !== taskId);
  const targetList =
    source.id === columnId ? fromList : target.tasks.filter((candidate) => candidate.id !== taskId);

  const insertAt = beforeTaskId
    ? targetList.findIndex((candidate) => candidate.id === beforeTaskId)
    : -1;
  const at = insertAt === -1 ? targetList.length : insertAt;
  targetList.splice(at, 0, task);

  return columns.map((column) => {
    if (column.id === source?.id && column.id === columnId) return { ...column, tasks: targetList };
    if (column.id === source?.id) return { ...column, tasks: fromList };
    if (column.id === columnId) return { ...column, tasks: targetList };
    return column;
  });
}

function ColumnCard({
  boardId,
  column,
  canEdit,
  dragging,
  hover,
  onDragStart,
  onDragEnd,
  onHover,
  onDrop,
  onChanged,
  onError,
  onOpenTask,
}: {
  boardId: string;
  column: Column;
  canEdit: boolean;
  dragging: DragInfo | null;
  hover: HoverTarget | null;
  onDragStart(taskId: string, fromColumnId: string): void;
  onDragEnd(): void;
  onHover(target: HoverTarget | null): void;
  onDrop(target: HoverTarget): void;
  onChanged(): void;
  onError(message: string): void;
  onOpenTask(task: Task): void;
}) {
  const [taskTitle, setTaskTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(column.title);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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

  async function handleRename(event: FormEvent) {
    event.preventDefault();
    const title = renameValue.trim();
    if (!title || busy) return;
    setBusy(true);
    setError(null);
    try {
      await renameColumn(boardId, column.id, title);
      setRenaming(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not rename column");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteColumn() {
    // Two-step confirm: the first click arms the delete, the second runs it.
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      await deleteColumn(boardId, column.id);
      onChanged();
    } catch (err) {
      setConfirmingDelete(false);
      onError(err instanceof ApiError ? err.message : "Could not delete column");
    } finally {
      setBusy(false);
    }
  }

  const draggingInto = dragging !== null && hover?.columnId === column.id;
  const draggingSelf = dragging !== null && dragging.fromColumnId === column.id;

  return (
    <section
      className={`flex max-h-full w-72 shrink-0 flex-col rounded-xl bg-slate-200/70 ${
        draggingSelf ? "opacity-90" : ""
      }`}
    >
      <header className="group flex items-center justify-between gap-1 px-3 pb-1 pt-3">
        {renaming && canEdit ? (
          <form onSubmit={handleRename} className="flex min-w-0 flex-1 items-center gap-1">
            <input
              type="text"
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              maxLength={120}
              className="w-full min-w-0 rounded-md border border-slate-300 px-1.5 py-0.5 text-sm font-semibold text-slate-700 outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={busy || !renameValue.trim()}
              className="shrink-0 rounded-md bg-indigo-600 px-1.5 py-0.5 text-xs font-medium text-white disabled:opacity-50"
            >
              Save
            </button>
          </form>
        ) : (
          <>
            <h3 className="truncate text-sm font-semibold text-slate-700" title={column.title}>
              {column.title}
            </h3>
            <span className="text-xs font-medium text-slate-400">{column.tasks.length}</span>
            {canEdit ? (
              <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                <button
                  type="button"
                  aria-label="Rename column"
                  onClick={() => {
                    setRenameValue(column.title);
                    setRenaming(true);
                  }}
                  className="rounded p-1 text-slate-400 hover:bg-slate-300/60 hover:text-slate-600"
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                    <path d="m5.433 13.917 1.262-3.155A4 4 0 0 1 7.58 9.42l6.92-6.918a2.121 2.121 0 0 1 3 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 0 1-.65-.65Z" />
                    <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0 0 10 3H4.75A2.75 2.75 0 0 0 2 5.75v9.5A2.75 2.75 0 0 0 4.75 18h9.5A2.75 2.75 0 0 0 17 15.25V10a.75.75 0 0 0-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5Z" />
                  </svg>
                </button>
                <button
                  type="button"
                  aria-label="Delete column"
                  onClick={handleDeleteColumn}
                  className="rounded p-1 text-slate-400 hover:bg-red-100 hover:text-red-600"
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                    <path
                      fillRule="evenodd"
                      d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482 41.03 41.03 0 0 0-2.365-.298V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              </span>
            ) : null}
          </>
        )}
      </header>
      {error ? <p className="px-3 pb-1 text-xs text-red-600">{error}</p> : null}

      {confirmingDelete ? (
        <div className="mx-2 mb-1 flex items-center justify-between gap-2 rounded-lg bg-red-50 px-2 py-1.5 ring-1 ring-red-200">
          <span className="text-xs font-medium text-red-700">
            Delete this column and its {column.tasks.length}{" "}
            {column.tasks.length === 1 ? "task" : "tasks"}?
          </span>
          <span className="flex shrink-0 gap-1">
            <button
              type="button"
              disabled={busy}
              onClick={handleDeleteColumn}
              className="rounded bg-red-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="rounded bg-white px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
            >
              Keep
            </button>
          </span>
        </div>
      ) : null}

      <div
        className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2"
        onDragOver={(e) => {
          // Dragging over the gap between cards (not a card or the append
          // zone) clears the indicator so stale lines don't linger.
          if (dragging && e.target === e.currentTarget) {
            e.preventDefault();
            onHover(null);
          }
        }}
      >
        {column.tasks.length === 0 && !adding ? (
          <p className="px-2 py-4 text-center text-xs text-slate-400">
            {dragging ? "Drop task here" : "No tasks yet"}
          </p>
        ) : null}

        {column.tasks.map((task) => (
          <div key={task.id}>
            {hover?.columnId === column.id && hover.beforeTaskId === task.id ? (
              <DropLine />
            ) : null}
            <TaskCard
              task={task}
              canEdit={canEdit}
              isDragging={dragging?.taskId === task.id}
              onDragStart={() => onDragStart(task.id, column.id)}
              onDragEnd={onDragEnd}
              onDragOverCard={(e) => {
                if (!dragging || dragging.taskId === task.id) return;
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                const beforeSelf = e.clientY < rect.top + rect.height / 2;
                onHover({
                  columnId: column.id,
                  beforeTaskId: beforeSelf ? task.id : nextTaskId(task, column.tasks),
                });
              }}
              onDropCard={(e) => {
                if (!dragging) return;
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                const beforeSelf = e.clientY < rect.top + rect.height / 2;
                onDrop({
                  columnId: column.id,
                  beforeTaskId: beforeSelf ? task.id : nextTaskId(task, column.tasks),
                });
              }}
              onOpen={() => onOpenTask(task)}
            />
          </div>
        ))}

        {/* Drop zone: drop anywhere below the last card to append at the end. */}
        <div
          onDragOver={(e) => {
            if (!dragging) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            onHover({ columnId: column.id, beforeTaskId: null });
          }}
          onDragLeave={() => {
            if (dragging) onHover(null);
          }}
          onDrop={(e) => {
            if (!dragging) return;
            e.preventDefault();
            onDrop({ columnId: column.id, beforeTaskId: null });
          }}
          className={`min-h-2 flex-1 rounded-lg transition ${
            draggingInto && hover?.beforeTaskId === null ? "bg-indigo-50 ring-2 ring-inset ring-indigo-400" : ""
          }`}
        />

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

/** Id of the task that follows `task` in `tasks`, or null if it is last. */
function nextTaskId(task: Task, tasks: Task[]): string | null {
  const index = tasks.findIndex((candidate) => candidate.id === task.id);
  const next = tasks[index + 1];
  return next?.id ?? null;
}

function DropLine() {
  return <div className="h-0.5 rounded-full bg-indigo-500" />;
}

function TaskCard({
  task,
  canEdit,
  isDragging,
  onDragStart,
  onDragEnd,
  onDragOverCard,
  onDropCard,
  onOpen,
}: {
  task: Task;
  canEdit: boolean;
  isDragging: boolean;
  onDragStart(): void;
  onDragEnd(): void;
  onDragOverCard(e: DragEvent<HTMLElement>): void;
  onDropCard(e: DragEvent<HTMLElement>): void;
  onOpen(): void;
}) {
  return (
    <article
      draggable={canEdit}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", task.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={onDragOverCard}
      onDrop={onDropCard}
      onClick={onOpen}
      className={`group rounded-lg bg-white p-3 shadow-sm transition hover:shadow ${
        isDragging ? "opacity-40" : ""
      } ${canEdit ? "cursor-grab select-none active:cursor-grabbing" : "cursor-pointer"}`}
      title="Open task"
    >
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