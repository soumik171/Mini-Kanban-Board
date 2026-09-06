"use client";

// A tiny app-wide lock so only one inline edit session can be open at a time
// (e.g. the board title in the board header and the user's display name in the
// app header must never be edited simultaneously). When one session claims the
// lock, every other session's edit UI closes itself.
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type EditSession = "board-title" | "profile-name" | null;

interface EditLockValue {
  active: EditSession;
  claim(session: NonNullable<EditSession>): void;
  release(session: NonNullable<EditSession>): void;
}

const EditLockContext = createContext<EditLockValue | null>(null);

export function EditLockProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<EditSession>(null);

  const claim = useCallback((session: NonNullable<EditSession>) => {
    setActive(session);
  }, []);

  const release = useCallback((session: NonNullable<EditSession>) => {
    setActive((current) => (current === session ? null : current));
  }, []);

  const value = useMemo(
    () => ({ active, claim, release }),
    [active, claim, release],
  );

  return <EditLockContext.Provider value={value}>{children}</EditLockContext.Provider>;
}

export function useEditLock(): EditLockValue {
  const context = useContext(EditLockContext);
  if (!context) {
    throw new Error("useEditLock must be used inside <EditLockProvider>");
  }
  return context;
}