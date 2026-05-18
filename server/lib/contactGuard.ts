/**
 * contactGuard — pre-send suppression check for worker outreach.
 *
 * Fail-open: if the guard throws (DB down, etc.) we default to allowing
 * contact. Better to send a stray message during an outage than to silently
 * block all comms indefinitely.
 *
 * Callers MUST still log or audit their own skip events so the audit trail
 * reflects the original decision, not just the guard call.
 */

import { storage } from "../storage";
import { createLogger } from "./logger";

const log = createLogger("ContactGuard");

export interface ContactGuardResult {
  allowed: boolean;
  reason?: string;        // human-readable reason if blocked
  suppressionId?: string; // ID of the active suppression that blocked
}

/**
 * Check if outreach to a worker is currently allowed.
 * Returns { allowed: false, reason, suppressionId } when an active
 * contact_suppression exists for the worker.
 *
 * Fail-open: errors are caught and logged; the function always returns
 * { allowed: true } on failure so a guard outage never silently blocks comms.
 */
export async function isOutreachAllowed(workerId: string): Promise<ContactGuardResult> {
  try {
    const active = await storage.getActiveSuppressionsForWorker(workerId);
    if (active.length === 0) {
      return { allowed: true };
    }
    // Use the most recent (first) active suppression as the blocker
    const blocker = active[0];
    return {
      allowed: false,
      reason: blocker.reason,
      suppressionId: blocker.id,
    };
  } catch (err) {
    // Fail open — if the guard is broken, default to allowing contact
    // (better to send a stray message than block all comms during outage)
    log.error("contactGuard failed — failing open", {}, err);
    return { allowed: true };
  }
}
