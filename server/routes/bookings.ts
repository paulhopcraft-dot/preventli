import express, { type Response, type Router } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { authorize, type AuthRequest } from "../middleware/auth";
import { insertTelehealthBookingSchema, type TelehealthBookingStatus, type InsertTelehealthBooking } from "@shared/schema";
import { createLogger } from "../lib/logger";
import { sendEmail } from "../services/emailService";

const logger = createLogger("BookingsRoutes");
const router: Router = express.Router();

/**
 * @route GET /api/bookings
 * @desc List all telehealth bookings for the organization
 * @access Private
 */
router.get("/", authorize(), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const bookings = await storage.listTelehealthBookings(organizationId);
    res.json({ bookings });
  } catch (error) {
    logger.error("Error listing bookings:", undefined, error);
    res.status(500).json({ error: "Failed to retrieve bookings" });
  }
});

/**
 * @route POST /api/bookings
 * @desc Create a telehealth booking request
 * @access Private
 */
router.post("/", authorize(), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const validatedData = insertTelehealthBookingSchema.parse({
      ...req.body,
      organizationId,
      status: "pending",
    }) as InsertTelehealthBooking;
    const booking = await storage.createTelehealthBooking(validatedData);
    logger.info("Telehealth booking created", { bookingId: booking.id, organizationId });

    // Notify Preventli team of new booking (fire-and-forget)
    const vd = validatedData as any;
    const notifyEmail = process.env.BOOKING_NOTIFY_EMAIL ?? "jacinta@preventli.ai";
    const serviceLabel = vd.serviceType ?? "telehealth consultation";
    const appointmentLabel = (vd.appointmentType ?? "appointment").replace(/_/g, " ");
    sendEmail({
      to: notifyEmail,
      subject: `New Telehealth Booking — ${vd.workerName}`,
      body: `A new telehealth booking has been submitted.

Worker: ${vd.workerName}
Email: ${vd.workerEmail ?? "not provided"}
Employer: ${vd.employerName ?? "not provided"}
Service: ${serviceLabel}
Appointment type: ${appointmentLabel}
Referral requested: ${vd.requestReferral ? "Yes" : "No"}
Notes: ${vd.employerNotes ?? "none"}

Booking ID: ${booking.id}
Submitted: ${new Date().toLocaleString("en-AU", { timeZone: "Australia/Melbourne" })}

Log in to Preventli to confirm or manage this booking.`,
    }).catch((err) => logger.error("Failed to send booking notification email", undefined, err));

    res.status(201).json({ booking });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.errors });
    }
    logger.error("Error creating booking:", undefined, error);
    res.status(500).json({ error: "Failed to create booking" });
  }
});

/**
 * @route PATCH /api/bookings/:id
 * @desc Update booking status
 * @access Private
 */
router.patch("/:id", authorize(), async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { status } = req.body as { status: TelehealthBookingStatus };
    const validStatuses: TelehealthBookingStatus[] = ["pending", "confirmed", "completed", "cancelled"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status value" });
    }
    const booking = await storage.updateTelehealthBookingStatus(id, status);
    res.json({ booking });
  } catch (error) {
    logger.error("Error updating booking:", undefined, error);
    res.status(500).json({ error: "Failed to update booking" });
  }
});

export default router;
