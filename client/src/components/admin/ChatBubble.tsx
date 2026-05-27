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
        className="fixed bottom-24 right-6 z-50 h-14 w-14 rounded-full bg-violet-600 text-white shadow-lg hover:scale-105 transition-transform flex items-center justify-center"
        aria-label={open ? "Close build-board chat" : "Open build-board chat"}
        data-testid="chat-bubble"
      >
        <MessageCircle className="h-6 w-6" />
      </button>
      <ChatDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}
