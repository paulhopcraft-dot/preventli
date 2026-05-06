import { useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { ChatWidget } from "./ChatWidget";

/**
 * Mounts Alex (the floating chat widget) on every authenticated page.
 *
 * Gates on `isAuthenticated` so the widget never appears on /login,
 * /forgot-password, /reset-password, or the public /check/:token route.
 *
 * Derives `caseContext` from the URL so Alex knows which case the user is
 * looking at — same regex PageLayout used to use.
 */
export function GlobalChatWidget() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) return null;

  const caseIdMatch = location.pathname.match(/\/(?:cases|summary|employer\/case)\/([^/]+)/);
  const workerIdMatch = location.pathname.match(/\/workers\/([^/]+)/);
  const caseContext = caseIdMatch
    ? { caseId: caseIdMatch[1] }
    : workerIdMatch
    ? { workerId: workerIdMatch[1] }
    : undefined;

  return <ChatWidget caseContext={caseContext} />;
}
