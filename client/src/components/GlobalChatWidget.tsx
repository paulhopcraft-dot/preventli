import { useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { ChatWidget } from "./ChatWidget";
import { MorningBriefingModal } from "./MorningBriefingModal";

export function GlobalChatWidget() {
  const { isAuthenticated, user } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) return null;

  const caseIdMatch = location.pathname.match(/\/(?:cases|summary|employer\/case)\/([^/]+)/);
  const workerIdMatch = location.pathname.match(/\/workers\/([^/]+)/);
  const caseContext = caseIdMatch
    ? { caseId: caseIdMatch[1] }
    : workerIdMatch
    ? { workerId: workerIdMatch[1] }
    : undefined;

  // Prefer the user's explicit preferredName (Alex training surface) over
  // email-derivation. Falls back to the email-split heuristic when unset.
  const preferred = user?.preferredName?.trim();
  const fromEmail = user?.email
    ? user.email.split("@")[0].split(".")[0].replace(/\d/g, "")
    : undefined;
  const userName = preferred
    ? preferred
    : fromEmail
    ? fromEmail.charAt(0).toUpperCase() + fromEmail.slice(1)
    : undefined;

  return (
    <>
      <MorningBriefingModal />
      <ChatWidget caseContext={caseContext} userName={userName} />
    </>
  );
}
