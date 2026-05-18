import { useState, useRef, useEffect } from "react";
import { Button } from "./ui/button";
import { Stethoscope, X, Send, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { getCsrfToken } from "@/lib/queryClient";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ChatWidgetProps {
  caseContext?: { caseId?: string; workerId?: string };
  userName?: string;
}

function getGreeting(userName?: string): string {
  const hour = new Date().getHours();
  const name = userName ? `, ${userName}` : "";

  if (hour < 12) {
    return `Good morning${name}! I've already been through your cases — there's a few things on your plate today. Want me to run you through them, or is there something specific on your mind?`;
  } else if (hour < 17) {
    return `Good afternoon${name}! How's the day going? I've been keeping an eye on your cases. Anything you need a hand with?`;
  } else {
    return `Good evening${name}! Wrapping up? I can pull together where everything stands, or flag anything that needs attention tomorrow.`;
  }
}

function generateSessionId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

function getOrCreateSessionId(): string {
  const key = "preventli_chat_session";
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const id = generateSessionId();
  sessionStorage.setItem(key, id);
  return id;
}

export function ChatWidget({ caseContext, userName }: ChatWidgetProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: getGreeting(userName),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [suggestBooking, setSuggestBooking] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const sessionId = useRef(getOrCreateSessionId());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, open]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    const currentMessages = messages;
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);
    setSuggestBooking(false);

    // Add a placeholder streaming message
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const csrfToken = await getCsrfToken().catch(() => "");

      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
        },
        credentials: "include",
        body: JSON.stringify({
          message: text,
          sessionId: sessionId.current,
          context: caseContext,
          history: currentMessages,
        }),
      });

      if (!res.ok || !res.body) throw new Error("Request failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulatedText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          try {
            const payload = JSON.parse(trimmed.slice(6)) as
              | { type: "delta"; text: string }
              | { type: "done" }
              | { type: "error"; message: string };

            if (payload.type === "delta") {
              accumulatedText += payload.text;
              // Strip booking signal from display text
              const displayText = accumulatedText.replace("[SUGGEST_BOOKING]", "").trimEnd();
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: "assistant", content: displayText };
                return updated;
              });
            } else if (payload.type === "done") {
              setLoading(false);
              if (accumulatedText.includes("[SUGGEST_BOOKING]")) {
                setSuggestBooking(true);
              }
            } else if (payload.type === "error") {
              throw new Error(payload.message);
            }
          } catch {
            // Malformed line — skip
          }
        }
      }
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        // Replace the empty streaming placeholder with the error message
        if (updated[updated.length - 1]?.content === "") {
          updated[updated.length - 1] = {
            role: "assistant",
            content: "Sorry, I couldn't process that. Please try again.",
          };
        } else {
          updated.push({ role: "assistant", content: "Sorry, I couldn't process that. Please try again." });
        }
        return updated;
      });
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <>
      {/* Floating button */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
        {/* Expanded chat panel */}
        {open && (
          <div className="w-80 bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-primary text-primary-foreground rounded-t-2xl">
              <div className="flex items-center gap-2">
                <Stethoscope className="w-4 h-4" />
                <div>
                  <p className="text-sm font-semibold">Alex</p>
                  <p className="text-xs opacity-75">Your case manager</p>
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="opacity-75 hover:opacity-100 transition-opacity">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3 max-h-96">
              {messages.map((msg, i) => {
                const isStreamingMsg = loading && i === messages.length - 1 && msg.role === "assistant";
                if (isStreamingMsg && msg.content === "") return null;
                return (
                  <div
                    key={i}
                    className={cn(
                      "max-w-[85%] rounded-xl px-3 py-2 text-sm",
                      msg.role === "user"
                        ? "ml-auto bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {msg.content}
                    {isStreamingMsg && (
                      <span className="inline-block w-0.5 h-3.5 bg-muted-foreground ml-0.5 animate-pulse align-middle" />
                    )}
                  </div>
                );
              })}
              {loading && messages[messages.length - 1]?.content === "" && (
                <div className="bg-muted text-muted-foreground max-w-[85%] rounded-xl px-3 py-2 text-sm">
                  <span className="inline-flex items-center gap-1">
                    Alex is thinking
                    <span className="inline-flex gap-0.5">
                      <span className="animate-bounce" style={{ animationDelay: "0ms" }}>.</span>
                      <span className="animate-bounce" style={{ animationDelay: "150ms" }}>.</span>
                      <span className="animate-bounce" style={{ animationDelay: "300ms" }}>.</span>
                    </span>
                  </span>
                </div>
              )}

              {/* Inline booking suggestion */}
              {suggestBooking && (
                <div className="bg-primary/10 border border-primary/20 rounded-xl px-3 py-2">
                  <p className="text-xs text-muted-foreground mb-2">
                    It sounds like speaking with a doctor would help. Book a telehealth appointment?
                  </p>
                  <Button
                    size="sm"
                    variant="default"
                    className="w-full text-xs"
                    onClick={() => setBookingOpen(true)}
                  >
                    <Phone className="w-3 h-3 mr-1" />
                    Book Telehealth
                  </Button>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="flex items-center gap-2 p-3 border-t border-border">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Message Alex..."
                className="flex-1 text-sm bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
                disabled={loading}
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || loading}
                className="text-primary hover:text-primary/80 disabled:opacity-40 transition-opacity"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Toggle button */}
        <button
          onClick={() => setOpen((prev) => !prev)}
          className="flex items-center gap-2 bg-primary text-primary-foreground rounded-full pl-4 pr-5 py-3 shadow-lg hover:bg-primary/90 transition-colors"
        >
          <Stethoscope className="w-5 h-5" />
          <span className="text-sm font-medium">Chat with Alex</span>
        </button>
      </div>

      {/* Inline booking modal (triggered from chat) */}
      {bookingOpen && (
        <InlineBookingModal
          open={bookingOpen}
          onClose={() => setBookingOpen(false)}
          caseContext={caseContext}
        />
      )}
    </>
  );
}

// Minimal inline booking confirmation (avoids circular dep with BookingModal)
function InlineBookingModal({
  open,
  onClose,
  caseContext,
}: {
  open: boolean;
  onClose: () => void;
  caseContext?: { caseId?: string };
}) {
  // Lazy import BookingModal to avoid circular dependency
  const [BookingModalComponent, setBookingModalComponent] =
    useState<React.ComponentType<{ open: boolean; onClose: () => void; caseContext?: { caseId?: string } }> | null>(null);

  useEffect(() => {
    import("./BookingModal").then((m) => {
      setBookingModalComponent(() => m.BookingModal);
    });
  }, []);

  if (!BookingModalComponent) return null;
  return <BookingModalComponent open={open} onClose={onClose} caseContext={caseContext} />;
}
