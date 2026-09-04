"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { AppHeader } from "@/components/app-header";
import { RequireAuth } from "@/components/require-auth";
import { ApiError, createBoard, deleteBoard, listBoards, type ListedBoard } from "@/lib/api";
import { ROLE_STYLES, timeAgo } from "@/lib/format";

export default function BoardsPage() {
  return (
    <RequireAuth>
      <AppHeader />
      <BoardsContent />
    </RequireAuth>
  );
}

function BoardsContent() {
  const [boards, setBoards] = useState<ListedBoard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setBoards(await listBoards());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load boards");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial fetch: state updates happen only after the awaited request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      await createBoard(trimmed);
      setTitle("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create board");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteBoard(id);
      setConfirmDeleteId(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete board");
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Your boards</h1>
          <p className="mt-1 text-sm text-slate-500">
            Boards you own or have been invited to
          </p>
        </div>
      </div>

      {error ? (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {boards.map((board) => (
          <div
            key={board.id}
            className="group relative flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md"
          >
            <Link href={`/boards/${board.id}`} className="flex flex-1 flex-col">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold text-slate-900 group-hover:text-indigo-700">
                  {board.title}
                </h2>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_STYLES[board.role]}`}
                >
                  {board.role}
                </span>
              </div>
              {board.description ? (
                <p className="mt-1 line-clamp-2 text-sm text-slate-500">{board.description}</p>
              ) : null}
              <p className="mt-3 text-xs text-slate-400">
                Owned by {board.owner.name} · updated {timeAgo(board.updatedAt)}
              </p>
            </Link>
            {board.role === "OWNER" ? (
              <div className="mt-3 border-t border-slate-100 pt-2">
                {confirmDeleteId === board.id ? (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-500">Delete permanently?</span>
                    <button
                      type="button"
                      onClick={() => void handleDelete(board.id)}
                      className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700"
                    >
                      Yes, delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(board.id)}
                    className="text-xs font-medium text-slate-400 transition hover:text-red-600"
                  >
                    Delete
                  </button>
                )}
              </div>
            ) : null}
          </div>
        ))}

        {/* New board card */}
        <div className="flex min-h-40 flex-col justify-center rounded-xl border-2 border-dashed border-slate-300 bg-transparent p-5">
          <form onSubmit={handleCreate} className="flex flex-col gap-2">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="New board name…"
              maxLength={120}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
            <button
              type="submit"
              disabled={creating || !title.trim()}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
            >
              {creating ? "Creating…" : "Create board"}
            </button>
          </form>
        </div>
      </div>

      {loading ? (
        <p className="mt-8 text-center text-sm text-slate-500">Loading boards…</p>
      ) : null}
    </main>
  );
}
