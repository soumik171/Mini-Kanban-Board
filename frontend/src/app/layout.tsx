import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AuthProvider } from "@/components/auth-provider";
import { EditLockProvider } from "@/lib/edit-lock";

import "./globals.css";

export const metadata: Metadata = {
  title: "Mini Kanban",
  description: "A collaborative kanban board with roles, activity, and live updates.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-slate-100 text-slate-900">
        <AuthProvider>
          <EditLockProvider>{children}</EditLockProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
