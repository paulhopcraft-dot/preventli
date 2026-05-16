import { Router, type Response } from "express";
import { storage } from "../../storage";
import { authorize, type AuthRequest } from "../../middleware/auth";
import { z } from "zod";

const router = Router();
router.use(authorize(["admin"]));

/** GET /api/admin/inbound-emails — list unmatched/failed emails */
router.get("/", async (_req: AuthRequest, res: Response) => {
  try {
    const emails = await storage.getFailedCaseEmails();
    res.json({ data: emails, total: emails.length });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch emails" });
  }
});

const assignSchema = z.object({ caseId: z.string().min(1) });

/** POST /api/admin/inbound-emails/:id/assign — manually link email to a case */
router.post("/:id/assign", async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const parsed = assignSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "caseId is required" });
  }
  try {
    const updated = await storage.assignEmailToCase(id, parsed.data.caseId);
    res.json({ success: true, email: updated });
  } catch (err) {
    res.status(500).json({ error: "Failed to assign email" });
  }
});

export default router;
