"use client";

import { useEffect, useState } from "react";

import {
  ApiError,
  addComment,
  deleteComment,
  listComments,
  type CommentItem,
} from "@/lib/api";
import { initials, timeAgo } from "@/lib/format";

export function TaskComments({
  boardId,
  taskId,
  canEdit,
  refreshKey = 0,
}: {
  boardId: string;
  taskId: string;
  canEdit: boolean;
  /** Bumped by the parent when a live comment event targets this task. */
  refreshKey?: number;
}) {
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    void listComments(boardId, taskId)
      .then(setComments)
      .catch(() => setComments([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, taskId, refreshKey]);

  async function handlePost() {
    const trimmed = content.trim();
    if (!trimmed || posting) return;
    setPosting(true);
    setError(null);
    try {
      await addComment(boardId, taskId, trimmed);
      setContent("");
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add comment");
    } finally {
      setPosting(false);
    }
  }

  async function handleDelete(comment: CommentItem) {
    setError(null);
    try {
      await deleteComment(boardId, taskId, comment.id);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete comment");
    }
  }

  return (
    <section className="border-t border-slate-100 pt-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Comments{comments.length > 0 ? ` (${comments.length})` : ""}
        </h3>
      </div>

      {error ? <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      {loading ? (
        <p className="py-2 text-sm text-slate-400">Loading comments…</p>
      ) : comments.length === 0 ? (
        <p className="py-2 text-sm text-slate-400">No comments yet.</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((comment) => (
            <li key={comment.id} className="flex gap-2.5">
              <span
                title={comment.author.name}
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-semibold text-indigo-700"
              >
                {initials(comment.author.name)}
              </span>
              <div className="min-w-0 flex-1 rounded-lg bg-slate-50 px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-700">{comment.author.name}</span>
                  <span className="shrink-0 text-[10px] text-slate-400">
                    {timeAgo(comment.createdAt)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-sm text-slate-700">{comment.content}</p>
              </div>
              {canEdit ? (
                <button
                  type="button"
                  aria-label="Delete comment"
                  title="Delete comment"
                  onClick={() => void handleDelete(comment)}
                  className="self-start rounded p-1 text-slate-300 transition hover:bg-red-50 hover:text-red-600"
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                    <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                  </svg>
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <div className="mt-3 space-y-2">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={2}
            placeholder="Write a comment…"
            className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void handlePost()}
              disabled={posting || !content.trim()}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50"
            >
              {posting ? "Posting…" : "Add comment"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}