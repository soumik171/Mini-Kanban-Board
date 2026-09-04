"use client";

import { useEffect, useState, type FormEvent } from "react";

import {
  ApiError,
  addMember,
  changeMemberRole,
  listMembers,
  removeMember,
  type BoardRole,
  type Member,
} from "@/lib/api";
import { ROLE_STYLES, initials } from "@/lib/format";

export function MembersPanel({
  boardId,
  isOwner,
  onClose,
}: {
  boardId: string;
  isOwner: boolean;
  onClose(): void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Exclude<BoardRole, "OWNER">>("EDITOR");
  const [inviting, setInviting] = useState(false);
  const [busyRole, setBusyRole] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [busyRemove, setBusyRemove] = useState(false);

  const refresh = () => {
    void listMembers(boardId)
      .then(setMembers)
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "Could not load members");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function handleInvite(event: FormEvent) {
    event.preventDefault();
    const email = inviteEmail.trim();
    if (!email || inviting) return;
    setInviting(true);
    setError(null);
    try {
      await addMember(boardId, email, inviteRole);
      setInviteEmail("");
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add member");
    } finally {
      setInviting(false);
    }
  }

  async function handleRoleChange(member: Member, role: Exclude<BoardRole, "OWNER">) {
    if (busyRole) return;
    setBusyRole(member.user.id);
    setError(null);
    try {
      await changeMemberRole(boardId, member.user.id, role);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change role");
    } finally {
      setBusyRole(null);
    }
  }

  async function handleRemove(member: Member) {
    // Two-step: first click arms the removal, the second runs it.
    if (removingId !== member.user.id) {
      setRemovingId(member.user.id);
      return;
    }
    if (busyRemove) return;
    setBusyRemove(true);
    setError(null);
    try {
      await removeMember(boardId, member.user.id);
      setRemovingId(null);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove member");
    } finally {
      setBusyRemove(false);
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
          <h2 className="text-base font-semibold text-slate-900">Members</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close members"
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
            <p className="text-sm text-slate-400">Loading members…</p>
          ) : (
            <ul className="space-y-2">
              {members.map((member) => {
                const removable = member.role !== "OWNER";
                const armed = removingId === member.user.id;
                return (
                  <li
                    key={member.user.id}
                    className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2.5"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">
                      {initials(member.user.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">{member.user.name}</p>
                      <p className="truncate text-xs text-slate-400">{member.user.email}</p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${ROLE_STYLES[member.role]}`}
                    >
                      {member.role}
                    </span>

                    {isOwner && removable ? (
                      <span className="flex shrink-0 items-center gap-1">
                        {armed ? (
                          <>
                            <button
                              type="button"
                              disabled={busyRemove}
                              onClick={() => void handleRemove(member)}
                              className="rounded bg-red-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                            >
                              Remove
                            </button>
                            <button
                              type="button"
                              onClick={() => setRemovingId(null)}
                              className="rounded px-1.5 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-100"
                            >
                              Keep
                            </button>
                          </>
                        ) : (
                          <>
                            <select
                              aria-label={`Role for ${member.user.name}`}
                              value={member.role}
                              disabled={busyRole === member.user.id}
                              onChange={(e) =>
                                void handleRoleChange(
                                  member,
                                  e.target.value as Exclude<BoardRole, "OWNER">,
                                )
                              }
                              className="rounded-md border border-slate-300 px-1.5 py-1 text-[11px] text-slate-600 outline-none focus:border-indigo-500 disabled:opacity-50"
                            >
                              <option value="EDITOR">EDITOR</option>
                              <option value="VIEWER">VIEWER</option>
                            </select>
                            <button
                              type="button"
                              aria-label={`Remove ${member.user.name}`}
                              title="Remove member"
                              onClick={() => void handleRemove(member)}
                              className="rounded p-1 text-slate-300 transition hover:bg-red-50 hover:text-red-600"
                            >
                              <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                              </svg>
                            </button>
                          </>
                        )}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {isOwner ? (
          <footer className="border-t border-slate-200 p-4">
            <form onSubmit={handleInvite} className="space-y-2">
              <p className="text-xs font-medium text-slate-500">
                Invite someone by email — they need an account on this app.
              </p>
              <div className="flex gap-2">
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="teammate@example.com"
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                />
                <select
                  value={inviteRole}
                  onChange={(e) =>
                    setInviteRole(e.target.value as Exclude<BoardRole, "OWNER">)
                  }
                  className="rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-600 outline-none focus:border-indigo-500"
                >
                  <option value="EDITOR">EDITOR</option>
                  <option value="VIEWER">VIEWER</option>
                </select>
                <button
                  type="submit"
                  disabled={inviting || !inviteEmail.trim()}
                  className="shrink-0 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50"
                >
                  {inviting ? "Adding…" : "Invite"}
                </button>
              </div>
            </form>
          </footer>
        ) : null}
      </aside>
    </div>
  );
}