"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { useAuth } from "@/components/auth-provider";
import { ApiError } from "@/lib/api";
import { useEditLock } from "@/lib/edit-lock";
import { initials } from "@/lib/format";

const NAME_SESSION = "profile-name" as const;

export function AppHeader() {
  const { user, logout, updateName } = useAuth();
  const { active, claim, release } = useEditLock();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // The lock is the single source of truth: this editor is open exactly when
  // it owns the lock, so claiming by another session (e.g. the board title)
  // closes it automatically.
  const isEditingName = active === NAME_SESSION;

  // Never leave the lock held after this component unmounts.
  useEffect(() => () => release(NAME_SESSION), [release]);

  async function handleLogout() {
    setBusy(true);
    await logout();
    router.replace("/login");
  }

  function startEditingName() {
    if (!user) return;
    setNameValue(user.name);
    setNameError(null);
    claim(NAME_SESSION);
  }

  function stopEditingName() {
    setNameError(null);
    release(NAME_SESSION);
  }

  async function handleSaveName(event: FormEvent) {
    event.preventDefault();
    const next = nameValue.trim();
    if (!next || savingName) return;
    setSavingName(true);
    setNameError(null);
    try {
      await updateName(next);
      stopEditingName();
    } catch (err) {
      setNameError(err instanceof ApiError ? err.message : "Could not update name");
    } finally {
      setSavingName(false);
    }
  }

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold text-slate-900">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-sm text-white">
            M
          </span>
          Mini Kanban
        </Link>
        <div className="flex items-center gap-3">
          {user ? (
            isEditingName ? (
              <form onSubmit={handleSaveName} className="flex items-center gap-1.5">
                <input
                  type="text"
                  autoFocus
                  value={nameValue}
                  onChange={(e) => setNameValue(e.target.value)}
                  maxLength={80}
                  className="w-36 rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700 outline-none focus:border-indigo-500"
                />
                <button
                  type="submit"
                  aria-label="Save name"
                  title="Save"
                  disabled={savingName || !nameValue.trim()}
                  className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-600 text-white transition hover:bg-indigo-700 disabled:opacity-50"
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" />
                  </svg>
                </button>
                <button
                  type="button"
                  aria-label="Cancel"
                  title="Cancel"
                  onClick={stopEditingName}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-200/70 hover:text-slate-600"
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                  </svg>
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={startEditingName}
                title="Edit your name"
                className="group flex items-center gap-2 rounded-md px-1 py-0.5 text-sm text-slate-600 hover:bg-slate-100"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
                  {initials(user.name)}
                </span>
                <span className="max-w-40 truncate">{user.name}</span>
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3 shrink-0 text-slate-400 opacity-0 transition group-hover:opacity-100">
                  <path d="m5.433 13.917 1.262-3.155A4 4 0 0 1 7.58 9.42l6.92-6.918a2.121 2.121 0 0 1 3 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 0 1-.65-.65Z" />
                </svg>
              </button>
            )
          ) : null}
          {nameError ? <span className="text-xs text-red-600">{nameError}</span> : null}
          <button
            type="button"
            onClick={handleLogout}
            disabled={busy}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
          >
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </div>
    </header>
  );
}