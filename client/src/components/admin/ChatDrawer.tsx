import { useEffect, useRef, useState } from "react";
import { Send, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string | null;
}

interface ChatDrawerProps {
  open: boolean;
  onClose: () => void;
}

const POLL_INTERVAL_MS = 5000;

export function ChatDrawer({ open, onClose }: ChatDrawerProps) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const lastPollRef = useRef<string>(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const seenIds = useRef<Set<string>>(new Set());

  // Poll for new messages every 5s while drawer is open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const fetchNew = async () => {
      try {
        const res = await fetch(
          `/api/dashboard/chat/messages?after=${encodeURIComponent(lastPollRef.current)}`,
          { credentials: "include" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { messages: ChatMessage[] };
        if (cancelled || !data.messages?.length) return;

        const fresh = data.messages.filter((m) => !seenIds.current.has(m.id));
        if (fresh.length === 0) return;

        for (const m of fresh) seenIds.current.add(m.id);
        setMessages((prev) => [...prev, ...fresh]);
        const newest = fresh[fresh.length - 1].createdAt;
        if (newest) lastPollRef.current = newest;
      } catch {
        // Network blip — silent retry next tick
      }
    };

    void fetchNew();
    const handle = setInterval(fetchNew, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [open]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || sending) return;

    setSending(true);
    const optimistic: ChatMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    seenIds.current.add(optimistic.id);
    setMessages((prev) => [...prev, optimistic]);
    setDraft("");

    try {
      const res = await fetch("/api/dashboard/chat", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          pageContext: {
            url: typeof window !== "undefined" ? window.location.pathname + window.location.search : "",
            screenLabel: typeof document !== "undefined" ? document.title : "",
          },
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { reply: string };
      const reply: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: data.reply,
        createdAt: new Date().toISOString(),
      };
      seenIds.current.add(reply.id);
      setMessages((prev) => [...prev, reply]);
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: `Error: ${err instanceof Error ? err.message : "failed to send"}`,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed bottom-44 right-6 z-50 w-96 max-w-[calc(100vw-2rem)] h-[32rem] max-h-[calc(100vh-12rem)] bg-card border rounded-xl shadow-2xl flex flex-col"
      data-testid="chat-drawer"
    >
      <header className="flex items-center justify-between px-4 py-3 border-b">
        <div>
          <p className="font-semibold text-sm">Alex — Build Board</p>
          <p className="text-xs text-muted-foreground">{user?.email ?? "Sign in to use chat"}</p>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-muted text-muted-foreground"
          aria-label="Close chat"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground pt-12">
            <p className="font-medium">Tell Alex about a bug, idea, or task.</p>
            <p className="mt-1">It'll land on the build board.</p>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                "flex flex-col max-w-[85%] rounded-lg px-3 py-2 text-sm",
                m.role === "user"
                  ? "bg-primary text-primary-foreground self-end ml-auto"
                  : "bg-muted text-foreground",
              )}
            >
              <span className="whitespace-pre-wrap break-words">{m.content}</span>
            </div>
          ))
        )}
      </div>

      <footer className="border-t p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend();
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="What's on your mind?"
            disabled={sending}
            className="flex-1 rounded-md border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
            data-testid="chat-input"
          />
          <Button type="submit" size="sm" disabled={sending || !draft.trim()}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </footer>
    </div>
  );
}
