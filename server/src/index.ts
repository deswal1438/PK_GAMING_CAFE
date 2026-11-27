import "node:process";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";
import { BookingModel, PaymentEvent, Resource, Service } from "./models.js";
import { calculateEndTime, overlaps } from "./booking.js";
import { PaymentProviderError, PineLabsOnlineProvider, type PaymentOrderStatus, type PaymentStatus, type PaymentWebhookEvent } from "./payment.js";

const app = express();
const port = Number(process.env.PORT || 8787);
const adminKey = process.env.ADMIN_API_KEY || "";
const demoPaymentEnabled = (process.env.ENABLE_ONE_RUPEE_DEMO || "false").toLowerCase() === "true";

const pineLabsConfigured = Boolean(
  process.env.PINE_LABS_CLIENT_ID &&
  process.env.PINE_LABS_CLIENT_SECRET &&
  process.env.PINE_LABS_WEBHOOK_SECRET &&
  process.env.PINE_LABS_CALLBACK_URL
);

const pineLabs = pineLabsConfigured ? new PineLabsOnlineProvider({
  baseUrl: process.env.PINE_LABS_BASE_URL || "https://pluraluat.v2.pinepg.in",
  clientId: process.env.PINE_LABS_CLIENT_ID || "",
  clientSecret: process.env.PINE_LABS_CLIENT_SECRET || "",
  webhookSecret: process.env.PINE_LABS_WEBHOOK_SECRET || "",
  callbackUrl: process.env.PINE_LABS_CALLBACK_URL || "",
  webhookToleranceSeconds: Number(process.env.PINE_LABS_WEBHOOK_TOLERANCE_SECONDS || 300),
  qrTtlSeconds: Number(process.env.PINE_LABS_QR_TTL_SECONDS || 600)
}) : null;

app.use(helmet());
app.use(cors({ origin: process.env.PUBLIC_ORIGIN || true }));
app.use(express.json({
  limit: "64kb",
  verify: (request, _response, buffer) => {
    (request as express.Request & { rawBody?: string }).rawBody = buffer.toString("utf8");
  }
}));
app.use(rateLimit({ windowMs: 60_000, limit: 80, standardHeaders: true, legacyHeaders: false }));
const demoPaymentLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "₹1 demo limit reached. Please try again later." }
});

function requireAdmin(request: express.Request, response: express.Response, next: express.NextFunction) {
  if (!adminKey || request.header("x-admin-key") !== adminKey) return response.status(401).json({ error: "Admin authentication required" });
  return next();
}

function statusTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function tokenMatches(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(statusTokenHash(token), "utf8");
  const expected = Buffer.from(expectedHash, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function expectedMinorUnits(amountInRupees: number): number {
  return Math.round(amountInRupees * 100);
}

function indiaDateAndTime(now = new Date()): { date: string; startTime: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return { date: `${value("year")}-${value("month")}-${value("day")}`, startTime: `${value("hour")}:${value("minute")}` };
}

function validatePaymentAmount(booking: { amount: number; providerOrderId?: string | null }, event: PaymentOrderStatus | PaymentWebhookEvent) {
  if (event.status === "SUCCESS" && (!event.providerOrderId || event.amountMinorUnits === undefined || !event.currency)) {
    throw new PaymentProviderError("Successful payment response is missing order, amount or currency", 400);
  }
  if (event.currency && event.currency !== "INR") throw new PaymentProviderError("Payment currency does not match booking", 400);
  if (event.amountMinorUnits !== undefined && event.amountMinorUnits !== expectedMinorUnits(booking.amount)) throw new PaymentProviderError("Payment amount does not match booking", 400);
  if (booking.providerOrderId && event.providerOrderId && booking.providerOrderId !== event.providerOrderId) throw new PaymentProviderError("Provider order does not match booking", 400);
}

function nextPaymentStatus(current: string, incoming: PaymentStatus): PaymentStatus {
  if (current === "REFUNDED") return "REFUNDED";
  if (incoming === "REFUNDED") return "REFUNDED";
  if (current === "SUCCESS") return "SUCCESS";
  return incoming;
}

async function applyPaymentStatus(booking: InstanceType<typeof BookingModel>, event: PaymentOrderStatus | PaymentWebhookEvent) {
  validatePaymentAmount(booking, event);
  const status = nextPaymentStatus(String(booking.paymentStatus), event.status);
  booking.paymentStatus = status;
  if (event.providerOrderId) booking.providerOrderId = event.providerOrderId;
  if (event.reference) booking.paymentReference = event.reference;
  if (status === "SUCCESS") {
    booking.bookingStatus = "CONFIRMED";
    booking.paymentVerifiedAt = new Date();
  } else if (status === "REFUNDED") {
    booking.bookingStatus = "CANCELLED";
  }
  await booking.save();
}

async function reconcilePendingPayment(booking: InstanceType<typeof BookingModel>) {
  if (!pineLabs || !booking.providerOrderId || !["PENDING", "FAILED"].includes(String(booking.paymentStatus))) return booking;
  try {
    const event = await pineLabs.getOrderStatus(booking.bookingId);
    await applyPaymentStatus(booking, event);
  } catch (error) {
    console.error("Automatic Pine Labs reconciliation failed", booking.bookingId, error instanceof Error ? error.message : error);
  }
  return booking;
}

async function createPaymentSession(booking: InstanceType<typeof BookingModel>) {
  if (!pineLabs) return null;
  const order = await pineLabs.createOrder({
    bookingId: booking.bookingId,
    amountInRupees: booking.amount,
    customerName: booking.customerName,
    customerPhone: booking.phone,
    customerEmail: booking.email || undefined
  });
  booking.paymentProvider = order.provider;
  booking.providerOrderId = order.providerOrderId;
  booking.paymentStatus = "PENDING";
  await booking.save();
  return order;
}

function publicQrSession(payment: Awaited<ReturnType<PineLabsOnlineProvider["createOrder"]>>) {
  return {
    available: true,
    mode: "UPI_QR",
    qrImageUrl: payment.qrImageUrl,
    upiIntentUrl: payment.upiIntentUrl || null,
    expiresAt: payment.expiresAt
  };
}

function publicPaymentState(booking: InstanceType<typeof BookingModel>) {
  return {
    bookingId: booking.bookingId,
    bookingStatus: booking.bookingStatus,
    paymentStatus: booking.paymentStatus,
    paymentProvider: booking.paymentProvider || null,
    paymentReference: booking.paymentReference || null,
    paymentVerifiedAt: booking.paymentVerifiedAt || null
  };
}

app.get("/api/health", (_request, response) => response.json({
  ok: true,
  service: "pk-gaming-cafe-api",
  payments: { provider: "PINE_LABS_ONLINE", mode: "UPI_QR", configured: pineLabsConfigured },
  oneRupeeDemoEnabled: demoPaymentEnabled && pineLabsConfigured
}));

app.get("/api/resources", async (_request, response) => response.json(await Resource.find({ active: true }).sort({ code: 1 }).lean()));
app.get("/api/services", async (_request, response) => response.json(await Service.find({ active: true }).sort({ name: 1 }).lean()));

app.post("/api/demo-bookings", demoPaymentLimiter, async (request, response) => {
  if (!demoPaymentEnabled) return response.status(404).json({ error: "₹1 payment demo is not enabled" });
  if (!pineLabs) return response.status(503).json({ error: "Secure online payment is not configured" });
  const body = request.body as Record<string, unknown>;
  const customerName = String(body.customerName || "").trim();
  const phone = String(body.phone || "").replace(/\D/g, "").slice(-10);
  if (customerName.length < 2 || phone.length !== 10) return response.status(400).json({ error: "Valid name and 10-digit mobile number are required" });

  const [resource, service] = await Promise.all([
    Resource.findOne({ code: "DEMO-VERIFY-01", type: "DEMO" }),
    Service.findOne({ slug: "payment-demo", resourceType: "DEMO" })
  ]);
  if (!resource || !service) return response.status(503).json({ error: "₹1 demo catalogue is not seeded" });
  const recentDemo = await BookingModel.exists({
    phone,
    serviceId: service._id,
    createdAt: { $gte: new Date(Date.now() - 30 * 60_000) }
  });
  if (recentDemo) return response.status(429).json({ error: "Only one ₹1 demo is allowed per mobile number every 30 minutes" });

  const { date, startTime } = indiaDateAndTime();
  const bookingId = `DEMO-${new Date().getFullYear()}-${randomUUID().slice(0, 6).toUpperCase()}`;
  const statusToken = randomBytes(32).toString("base64url");
  const booking = await BookingModel.create({
    bookingId,
    customerName,
    phone,
    resourceId: resource._id,
    serviceId: service._id,
    date,
    startTime,
    endTime: calculateEndTime(startTime, 15),
    duration: 15,
    amount: 1,
    bookingStatus: "PENDING",
    paymentStatus: "PENDING",
    statusTokenHash: statusTokenHash(statusToken),
    notes: "₹1 automatic payment verification demo; not a gaming slot"
  });

  try {
    const payment = await createPaymentSession(booking);
    if (!payment) throw new PaymentProviderError("Secure UPI QR is unavailable", 503);
    return response.status(201).json({
      ...publicPaymentState(booking),
      amount: 1,
      statusToken,
      demo: true,
      payment: publicQrSession(payment)
    });
  } catch (error) {
    await BookingModel.deleteOne({ _id: booking._id, paymentStatus: { $ne: "SUCCESS" } });
    const statusCode = error instanceof PaymentProviderError ? error.statusCode : 502;
    return response.status(statusCode).json({ error: "₹1 secure QR is temporarily unavailable; no demo booking was created" });
  }
});

app.post("/api/bookings", async (request, response) => {
  const body = request.body as Record<string, unknown>;
  const customerName = String(body.customerName || "").trim();
  const phone = String(body.phone || "").replace(/\D/g, "").slice(-10);
  const email = String(body.email || "").trim().toLowerCase() || undefined;
  const date = String(body.date || "");
  const startTime = String(body.startTime || "");
  const duration = Number(body.duration || 0);
  const resourceId = String(body.resourceId || "");
  const resourceCode = String(body.resourceCode || "");
  const serviceId = String(body.serviceId || "");
  const serviceSlug = String(body.serviceSlug || "");
  if (customerName.length < 2 || phone.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(startTime) || duration < 15 || (!resourceId && !resourceCode) || (!serviceId && !serviceSlug)) return response.status(400).json({ error: "Invalid booking details" });
  if (!pineLabs) return response.status(503).json({ error: "Secure online payment is not configured" });

  const resourceQuery = resourceId && mongoose.isValidObjectId(resourceId) ? { _id: resourceId, active: true } : { code: resourceCode || resourceId, active: true };
  const serviceQuery = serviceId && mongoose.isValidObjectId(serviceId) ? { _id: serviceId, active: true } : { slug: serviceSlug || serviceId, active: true };
  const [resource, service] = await Promise.all([Resource.findOne(resourceQuery).lean(), Service.findOne(serviceQuery).lean()]);
  if (!resource || !service) return response.status(400).json({ error: "Resource or service unavailable" });
  if (resource.type !== service.resourceType) return response.status(400).json({ error: "Resource is incompatible with selected service" });

  const prices = service.prices as unknown as Map<string, number> | Record<string, number>;
  const amount = prices instanceof Map ? prices.get(String(duration)) : prices[String(duration)];
  if (typeof amount !== "number") return response.status(400).json({ error: "Duration is not available for this service" });

  const endTime = calculateEndTime(startTime, duration);
  const existing = await BookingModel.find({ resourceId: resource._id, date, bookingStatus: { $in: ["PENDING", "CONFIRMED"] } });
  await Promise.all(existing.map((booking) => reconcilePendingPayment(booking)));
  const activeBookings = existing.filter((booking) => booking.bookingStatus === "CONFIRMED" || (booking.bookingStatus === "PENDING" && booking.paymentStatus === "PENDING"));
  if (activeBookings.some((booking) => overlaps(startTime, endTime, booking.startTime, booking.endTime))) return response.status(409).json({ error: "That resource is already booked or has a payment in progress" });

  const bookingId = `PK-${new Date().getFullYear()}-${randomUUID().slice(0, 6).toUpperCase()}`;
  const statusToken = randomBytes(32).toString("base64url");
  const booking = await BookingModel.create({
    bookingId,
    customerName,
    phone,
    email,
    resourceId: resource._id,
    serviceId: service._id,
    date,
    startTime,
    endTime,
    duration,
    amount,
    bookingStatus: "PENDING",
    paymentStatus: "PENDING",
    statusTokenHash: statusTokenHash(statusToken)
  });

  try {
    const payment = await createPaymentSession(booking);
    return response.status(201).json({ ...publicPaymentState(booking), amount: booking.amount, statusToken, payment: payment ? publicQrSession(payment) : { available: false } });
  } catch (error) {
    console.error("Pine Labs UPI QR creation failed", error instanceof Error ? error.message : error);
    await BookingModel.deleteOne({ _id: booking._id, paymentStatus: { $ne: "SUCCESS" }, providerOrderId: { $exists: false } });
    const statusCode = error instanceof PaymentProviderError ? error.statusCode : 502;
    return response.status(statusCode).json({ error: "Secure UPI QR is temporarily unavailable; no booking was confirmed" });
  }
});

app.post("/api/bookings/:bookingId/payment-session", async (request, response) => {
  const booking = await BookingModel.findOne({ bookingId: request.params.bookingId }).select("+statusTokenHash");
  const token = request.header("x-booking-token") || "";
  if (!booking || !token || !tokenMatches(token, booking.statusTokenHash)) return response.status(404).json({ error: "Booking not found" });
  if (booking.paymentStatus === "SUCCESS") return response.status(409).json({ error: "Booking is already paid" });
  if (!pineLabs) return response.status(503).json({ error: "Online payments are not configured" });
  try {
    const payment = await createPaymentSession(booking);
    return response.json({ ...publicPaymentState(booking), payment: payment ? publicQrSession(payment) : { available: false } });
  } catch (error) {
    const statusCode = error instanceof PaymentProviderError ? error.statusCode : 502;
    return response.status(statusCode).json({ error: error instanceof Error ? error.message : "UPI QR generation failed" });
  }
});

app.get("/api/bookings/:bookingId/payment-status", async (request, response) => {
  const booking = await BookingModel.findOne({ bookingId: request.params.bookingId }).select("+statusTokenHash");
  const token = request.header("x-booking-token") || "";
  if (!booking || !token || !tokenMatches(token, booking.statusTokenHash)) return response.status(404).json({ error: "Booking not found" });
  await reconcilePendingPayment(booking);
  return response.json(publicPaymentState(booking));
});

app.post("/api/payments/webhook/pine-labs", async (request, response) => {
  if (!pineLabs) return response.status(503).json({ error: "Pine Labs is not configured" });
  try {
    const rawBody = (request as express.Request & { rawBody?: string }).rawBody || JSON.stringify(request.body);
    const event = pineLabs.verifyWebhook(rawBody, {
      id: request.header("webhook-id") || "",
      timestamp: request.header("webhook-timestamp") || "",
      signature: request.header("webhook-signature") || ""
    });
    const booking = await BookingModel.findOne({ bookingId: event.bookingId });
    if (!booking) return response.status(404).json({ error: "Booking not found" });
    validatePaymentAmount(booking, event);

    if (await PaymentEvent.exists({ provider: "PINE_LABS_ONLINE", eventId: event.eventId })) return response.json({ received: true, duplicate: true });

    await applyPaymentStatus(booking, event);

    try {
      await PaymentEvent.create({
        provider: "PINE_LABS_ONLINE",
        eventId: event.eventId,
        bookingId: event.bookingId,
        providerOrderId: event.providerOrderId,
        status: event.status,
        payloadDigest: createHash("sha256").update(rawBody).digest("hex")
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === 11000) return response.json({ received: true, duplicate: true });
      throw error;
    }
    return response.json({ received: true });
  } catch (error) {
    const statusCode = error instanceof PaymentProviderError ? error.statusCode : 400;
    return response.status(statusCode).json({ error: error instanceof Error ? error.message : "Webhook rejected" });
  }
});

app.get("/api/admin/bookings", requireAdmin, async (_request, response) => response.json(await BookingModel.find().populate("resourceId serviceId").sort({ date: 1, startTime: 1 }).lean()));
app.patch("/api/admin/bookings/:bookingId/status", requireAdmin, async (request, response) => {
  const status = String(request.body.status || "");
  if (!["CANCELLED", "COMPLETED"].includes(status)) return response.status(400).json({ error: "Payment confirmation is automatic; admin can only cancel or complete a booking" });
  const booking = await BookingModel.findOne({ bookingId: request.params.bookingId });
  if (!booking) return response.status(404).json({ error: "Booking not found" });
  if (status === "COMPLETED" && booking.paymentStatus !== "SUCCESS") return response.status(409).json({ error: "Only an automatically verified paid booking can be completed" });
  if (status === "CANCELLED" && booking.paymentStatus === "SUCCESS") return response.status(409).json({ error: "A paid booking must be refunded through Pine Labs; refund webhook will cancel it automatically" });
  booking.bookingStatus = status === "CANCELLED" ? "CANCELLED" : "COMPLETED";
  await booking.save();
  return response.json(booking);
});

if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
await mongoose.connect(process.env.MONGODB_URI);
app.listen(port, () => console.log(`PK Gaming Cafe API listening on ${port}`));
