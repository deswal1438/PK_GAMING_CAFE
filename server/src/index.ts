import "node:process";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { BookingModel, Resource, Service } from "./models.js";
import { calculateEndTime, overlaps } from "./booking.js";
import { UpiWebhookProvider } from "./payment.js";

const app = express();
const port = Number(process.env.PORT || 8787);
const adminKey = process.env.ADMIN_API_KEY || "";
const webhook = new UpiWebhookProvider(process.env.UPI_WEBHOOK_SECRET || "");

app.use(helmet());
app.use(cors({ origin: process.env.PUBLIC_ORIGIN || true }));
app.use(express.json({ verify: (request, _response, buffer) => { (request as express.Request & { rawBody?: string }).rawBody = buffer.toString("utf8"); } }));
app.use(rateLimit({ windowMs: 60_000, limit: 80, standardHeaders: true, legacyHeaders: false }));

function requireAdmin(request: express.Request, response: express.Response, next: express.NextFunction) {
  if (!adminKey || request.header("x-admin-key") !== adminKey) return response.status(401).json({ error: "Admin authentication required" });
  return next();
}

app.get("/api/health", (_request, response) => response.json({ ok: true, service: "pk-gaming-cafe-api" }));
app.get("/api/resources", async (_request, response) => response.json(await Resource.find({ active: true }).sort({ code: 1 }).lean()));
app.get("/api/services", async (_request, response) => response.json(await Service.find({ active: true }).sort({ name: 1 }).lean()));

app.post("/api/bookings", async (request, response) => {
  const body = request.body as Record<string, unknown>;
  const customerName = String(body.customerName || "").trim();
  const phone = String(body.phone || "").replace(/\D/g, "");
  const date = String(body.date || "");
  const startTime = String(body.startTime || "");
  const duration = Number(body.duration || 0);
  const resourceId = String(body.resourceId || "");
  const serviceId = String(body.serviceId || "");
  if (customerName.length < 2 || phone.length < 10 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(startTime) || duration < 15 || !resourceId || !serviceId) return response.status(400).json({ error: "Invalid booking details" });
  const [resource, service] = await Promise.all([Resource.findOne({ _id: resourceId, active: true }).lean(), Service.findOne({ _id: serviceId, active: true }).lean()]);
  if (!resource || !service) return response.status(400).json({ error: "Resource or service unavailable" });
  const prices = service.prices as unknown as Map<string, number> | Record<string, number>;
  const amount = prices instanceof Map ? prices.get(String(duration)) : prices[String(duration)];
  if (typeof amount !== "number") return response.status(400).json({ error: "Duration is not available for this service" });
  const endTime = calculateEndTime(startTime, duration);
  const existing = await BookingModel.find({ resourceId: resource._id, date, bookingStatus: { $ne: "CANCELLED" } }).lean();
  if (existing.some((booking) => overlaps(startTime, endTime, booking.startTime, booking.endTime))) return response.status(409).json({ error: "That resource is already booked for this time" });
  const booking = await BookingModel.create({ bookingId: `PK-${new Date().getFullYear()}-${randomUUID().slice(0, 6).toUpperCase()}`, customerName, phone, email: body.email, resourceId: resource._id, serviceId: service._id, date, startTime, endTime, duration, amount, bookingStatus: "PENDING", paymentStatus: "PENDING" });
  return response.status(201).json({ bookingId: booking.bookingId, amount: booking.amount, bookingStatus: booking.bookingStatus, paymentStatus: booking.paymentStatus });
});

app.post("/api/payments/webhook/upi", async (request, response) => {
  try {
    const rawBody = (request as express.Request & { rawBody?: string }).rawBody || JSON.stringify(request.body);
    const signature = request.header(process.env.UPI_WEBHOOK_SIGNATURE_HEADER || "x-upi-signature") || "";
    const event = webhook.verifyWebhook(rawBody, signature);
    const update: Record<string, unknown> = { paymentStatus: event.status };
    if (event.reference) update.paymentReference = event.reference;
    if (event.status === "SUCCESS") update.bookingStatus = "CONFIRMED";
    await BookingModel.updateOne({ bookingId: event.bookingId }, { $set: update });
    return response.json({ received: true });
  } catch (error) {
    return response.status(400).json({ error: error instanceof Error ? error.message : "Webhook rejected" });
  }
});

app.get("/api/admin/bookings", requireAdmin, async (_request, response) => response.json(await BookingModel.find().populate("resourceId serviceId").sort({ date: 1, startTime: 1 }).lean()));
app.patch("/api/admin/bookings/:bookingId/status", requireAdmin, async (request, response) => response.json(await BookingModel.findOneAndUpdate({ bookingId: request.params.bookingId }, { $set: { bookingStatus: request.body.status } }, { new: true }).lean()));

await mongoose.connect(process.env.MONGODB_URI || "");
app.listen(port, () => console.log(`PK Gaming Cafe API listening on ${port}`));
