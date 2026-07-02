// Slot-based application shell. Lays out the sidebar + workspace section so App.tsx
// no longer owns the chrome scaffolding. The workspace children (topbar, status row,
// view bodies, modals) are passed through unchanged — no view props are re-threaded.
import type { ReactNode, Ref } from "react";

interface AppShellProps {
  sidebar: ReactNode;
  workspaceRef: Ref<HTMLElement>;
  children: ReactNode;
}

export function AppShell({ sidebar, workspaceRef, children }: AppShellProps) {
  return (
    <main className="app-shell">
      {sidebar}
      <section className="workspace" ref={workspaceRef}>
        {children}
      </section>
    </main>
  );
}
