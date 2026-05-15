import { useState, useRef, useEffect } from "react";
import { Button } from "./ui/button";
import { Stethoscope, X, Send, Phone } from "lucide-react";
import { cn } from "@/lib/utils";

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
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);
    setSuggestBooking(false);

    try {
      const res = await fetch("/api/chat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          message: text,
          sessionId: sessionId.current,
          context: caseContext,
          history: messages,
        }),
      });

      if (!res.ok) throw new Error("Request failed");

      const data = (await res.json()) as { reply: string; sessionId: string; suggestBooking?: boolean };
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
      if (data.suggestBooking) setSuggestBooking(true);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, I couldn't process that. Please try again." },
      ]);
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
              {messages.map((msg, i) => (
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
                </div>
              ))}
              {loading && (
                <div className="bg-muted text-muted-foreground max-w-[85%] rounded-xl px-3 py-2 text-sm animate-pulse">
                  Thinking...
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
