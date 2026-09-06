"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  getCurrentUser,
  login as apiLogin,
  logout as apiLogout,
  refreshSession,
  register as apiRegister,
  updateProfile,
  type User,
} from "@/lib/api";

interface AuthContextValue {
  user: User | null;
  ready: boolean;
  login(email: string, password: string): Promise<void>;
  register(name: string, email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  updateName(name: string): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function restoreSession() {
      // A page load may still hold a valid refresh cookie: trade it for a new
      // access token, then fetch the profile.
      const refreshed = await refreshSession();
      const current = refreshed ? await getCurrentUser() : null;
      if (!cancelled) {
        setUser(current);
        setReady(true);
      }
    }
    void restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const loggedIn = await apiLogin(email, password);
    setUser(loggedIn);
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    const created = await apiRegister(name, email, password);
    setUser(created);
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  const updateName = useCallback(async (name: string) => {
    const updated = await updateProfile(name);
    setUser(updated);
  }, []);

  const value = useMemo(
    () => ({ user, ready, login, register, logout, updateName }),
    [user, ready, login, register, logout, updateName],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return context;
}
