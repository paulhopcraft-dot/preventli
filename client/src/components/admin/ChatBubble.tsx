import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { ChatDrawer } from "./ChatDrawer";

export function ChatBubble() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:scale-105 transition-transform flex items-center justify-center"
        aria-label={open ? "Close build-board chat" : "Open build-board chat"}
        data-testid="chat-bubble"
      >
        <MessageCircle className="h-6 w-6" />
      </button>
      <ChatDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}
