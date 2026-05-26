import { Outlet } from "react-router-dom";
import { AdminSidebar } from "./AdminSidebar";
import { ChatBubble } from "./ChatBubble";
import { ThemeToggle } from "@/components/theme-toggle";

export function AdminLayout() {
  return (
    <div className="flex h-screen bg-background">
      <AdminSidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <header className="h-14 border-b bg-card flex items-center justify-between px-6">
          <div className="text-sm text-muted-foreground">
            Preventli System Administration
          </div>
          <div className="flex items-center gap-4">
            <ThemeToggle />
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </main>

      {/* Floating Alex build-board chat, admin-only by virtue of AdminRoute */}
      <ChatBubble />
    </div>
  );
}
