import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type PaymentStatus = "PENDING" | "SUCCESS" | "FAILED" | "REFUNDED";

export type PaymentOrder = {
  provider: "PINE_LABS_ONLINE";
  providerOrderId: string;
  qrImageUrl: string;
  upiIntentUrl?: string;
  expiresAt: string;
};

export type PaymentWebhookEvent = {
  eventId: string;
  bookingId: string;
  providerOrderId: string;
  status: PaymentStatus;
  reference?: string;
  amountMinorUnits?: number;
  currency?: string;
};

export type PaymentOrderStatus = Omit<PaymentWebhookEvent, "eventId">;

export type PineLabsWebhookHeaders = {
  id: string;
  timestamp: string;
  signature: string;
};

export type CreatePaymentInput = {
  bookingId: string;
  amountInRupees: number;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
};

type PineLabsConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
  callbackUrl: string;
  webhookToleranceSeconds?: number;
  qrTtlSeconds?: number;
};

type PineLabsOrder = {
  order_id?: string;
  merchant_order_reference?: string;
  status?: string;
  redirect_url?: string;
  challenge_url?: string;
  image_url?: string;
  order_amount?: { value?: number; currency?: string };
  payments?: Array<{
    id?: string;
    merchant_payment_reference?: string;
    acquirer_data?: { rrn?: string; acquirer_reference?: string };
  }>;
};

type FetchLike = typeof fetch;

export class PaymentProviderError extends Error {
  constructor(message: string, readonly statusCode = 502) {
    super(message);
    this.name = "PaymentProviderError";
  }
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PaymentProviderError("Unexpected Pine Labs response");
  return value as Record<string, unknown>;
}

function dataObject(value: unknown): Record<string, unknown> {
  const root = jsonObject(value);
  return root.data && typeof root.data === "object" && !Array.isArray(root.data) ? root.data as Record<string, unknown> : root;
}

function toMinorUnits(amountInRupees: number): number {
  if (!Number.isFinite(amountInRupees) || amountInRupees <= 0) throw new PaymentProviderError("Invalid payment amount", 400);
  return Math.round(amountInRupees * 100);
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, "").slice(-10);
}

function splitName(value: string): { firstName: string; lastName: string } {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts.shift() || "Guest", lastName: parts.join(" ") || "Customer" };
}

function mapPineLabsStatus(status: string | undefined, eventType?: string): PaymentStatus {
  const value = String(eventType || status || "").toUpperCase();
  if (value === "ORDER_PROCESSED" || value === "PROCESSED" || value === "SUCCESS") return "SUCCESS";
  if (value === "REFUND_PROCESSED" || value === "FULLY_REFUNDED" || value === "PARTIALLY_REFUNDED") return "REFUNDED";
  if (["PAYMENT_FAILED", "ORDER_FAILED", "ORDER_CANCELLED", "FAILED", "CANCELLED", "ATTEMPTED"].includes(value)) return "FAILED";
  return "PENDING";
}

function decodeWebhookSecret(value: string): Buffer {
  const normalized = value.trim();
  if (!normalized) throw new PaymentProviderError("Pine Labs webhook secret is not configured", 500);
  const decoded = Buffer.from(normalized, "base64");
  const roundTrip = decoded.toString("base64").replace(/=+$/, "");
  if (!decoded.length || roundTrip !== normalized.replace(/=+$/, "")) throw new PaymentProviderError("Pine Labs webhook secret must be base64 encoded", 500);
  return decoded;
}

function signatureCandidates(value: string): string[] {
  return value.split(/[\s,]+/).map((item) => item.trim()).filter((item) => item && item.toLowerCase() !== "v1");
}

function constantTimeMatch(expected: string, candidates: string[]): boolean {
  const expectedBuffer = Buffer.from(expected, "utf8");
  return candidates.some((candidate) => {
    const candidateBuffer = Buffer.from(candidate, "utf8");
    return expectedBuffer.length === candidateBuffer.length && timingSafeEqual(expectedBuffer, candidateBuffer);
  });
}

function parseOrder(value: unknown): PineLabsOrder {
  return dataObject(value) as PineLabsOrder;
}

function paymentReference(order: PineLabsOrder): string | undefined {
  const payment = order.payments?.[0];
  return payment?.acquirer_data?.rrn || payment?.acquirer_data?.acquirer_reference || payment?.merchant_payment_reference || payment?.id;
}

function qrExpiry(imageUrl: string, ttlSeconds: number): string {
  const fallback = Date.now() + ttlSeconds * 1000;
  try {
    const url = new URL(imageUrl);
    const rawDate = url.searchParams.get("X-Amz-Date");
    const rawSeconds = Number(url.searchParams.get("X-Amz-Expires"));
    if (!rawDate || !Number.isFinite(rawSeconds) || rawSeconds <= 0 || !/^\d{8}T\d{6}Z$/.test(rawDate)) {
      return new Date(fallback).toISOString();
    }
    const signedAt = Date.UTC(
      Number(rawDate.slice(0, 4)),
      Number(rawDate.slice(4, 6)) - 1,
      Number(rawDate.slice(6, 8)),
      Number(rawDate.slice(9, 11)),
      Number(rawDate.slice(11, 13)),
      Number(rawDate.slice(13, 15))
    );
    const signedExpiry = signedAt + rawSeconds * 1000;
    return new Date(Math.min(fallback, signedExpiry)).toISOString();
  } catch {
    return new Date(fallback).toISOString();
  }
}

export class PineLabsOnlineProvider {
  private accessToken?: { value: string; expiresAt: number };
  private readonly toleranceSeconds: number;
  private readonly qrTtlSeconds: number;

  constructor(private readonly config: PineLabsConfig, private readonly fetchImpl: FetchLike = fetch) {
    this.toleranceSeconds = config.webhookToleranceSeconds ?? 300;
    this.qrTtlSeconds = Math.min(Math.max(config.qrTtlSeconds ?? 600, 60), 1200);
  }

  private async request(path: string, init: RequestInit, authenticated = true): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");
    headers.set("request-id", randomUUID());
    headers.set("request-timestamp", new Date().toISOString());
    if (authenticated) headers.set("authorization", `Bearer ${await this.getAccessToken()}`);

    const response = await this.fetchImpl(`${this.config.baseUrl.replace(/\/$/, "")}${path}`, { ...init, headers });
    const raw = await response.text();
    let payload: unknown = {};
    if (raw) {
      try { payload = JSON.parse(raw); } catch { payload = { response: raw.slice(0, 300) }; }
    }
    if (!response.ok) {
      const object = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
      const message = String(object.message || object.response_message || `Pine Labs request failed (${response.status})`);
      throw new PaymentProviderError(message, response.status >= 400 && response.status < 500 ? 400 : 502);
    }
    return payload;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessToken.expiresAt - 60_000) return this.accessToken.value;
    const payload = dataObject(await this.request("/api/auth/v1/token", {
      method: "POST",
      body: JSON.stringify({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        grant_type: "client_credentials"
      })
    }, false));
    const token = String(payload.access_token || "");
    if (!token) throw new PaymentProviderError("Pine Labs token response did not contain access_token");
    const parsedExpiry = Date.parse(String(payload.expires_at || ""));
    const expiresInSeconds = Number(payload.expires_in);
    const expiresAt = Number.isFinite(parsedExpiry)
      ? parsedExpiry
      : Date.now() + (Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds * 1000 : 5 * 60_000);
    this.accessToken = { value: token, expiresAt };
    return token;
  }

  async createOrder(input: CreatePaymentInput): Promise<PaymentOrder> {
    const { firstName, lastName } = splitName(input.customerName);
    const callback = new URL(this.config.callbackUrl);
    callback.searchParams.set("bookingId", input.bookingId);
    const customer: Record<string, string> = {
      customer_id: input.bookingId,
      first_name: firstName,
      last_name: lastName,
      mobile_number: normalizePhone(input.customerPhone),
      country_code: "91"
    };
    if (input.customerEmail) customer.email_id = input.customerEmail;

    const amountMinorUnits = toMinorUnits(input.amountInRupees);
    const order = parseOrder(await this.request("/api/pay/v1/orders", {
      method: "POST",
      body: JSON.stringify({
        merchant_order_reference: input.bookingId,
        order_amount: { value: amountMinorUnits, currency: "INR" },
        pre_auth: false,
        integration_mode: "SEAMLESS",
        allowed_payment_methods: ["UPI"],
        notes: `PK Gaming booking ${input.bookingId}`.slice(0, 100),
        callback_url: callback.toString(),
        failure_callback_url: callback.toString(),
        purchase_details: { customer }
      })
    }));
    const providerOrderId = String(order.order_id || "");
    if (!providerOrderId) throw new PaymentProviderError("Pine Labs order response was incomplete");

    const payment = parseOrder(await this.request(`/api/pay/v1/orders/${encodeURIComponent(providerOrderId)}/payments`, {
      method: "POST",
      body: JSON.stringify({
        payments: [{
          merchant_payment_reference: `${input.bookingId}-${randomUUID().slice(0, 8)}`.slice(0, 50),
          payment_method: "UPI",
          payment_amount: { value: amountMinorUnits, currency: "INR" },
          payment_option: { upi_details: { txn_mode: "INTENT", upi_qr: true } }
        }]
      })
    }));
    const qrImageUrl = String(payment.image_url || "");
    const upiIntentUrl = String(payment.challenge_url || "");
    if (!qrImageUrl) throw new PaymentProviderError("Pine Labs did not return a UPI QR image");
    return {
      provider: "PINE_LABS_ONLINE",
      providerOrderId,
      qrImageUrl,
      upiIntentUrl: upiIntentUrl || undefined,
      expiresAt: qrExpiry(qrImageUrl, this.qrTtlSeconds)
    };
  }

  async getOrderStatus(bookingId: string): Promise<PaymentOrderStatus> {
    const order = parseOrder(await this.request(`/api/pay/v1/orders/reference/${encodeURIComponent(bookingId)}`, { method: "GET" }));
    return {
      bookingId: String(order.merchant_order_reference || bookingId),
      providerOrderId: String(order.order_id || ""),
      status: mapPineLabsStatus(order.status),
      reference: paymentReference(order),
      amountMinorUnits: order.order_amount?.value,
      currency: order.order_amount?.currency
    };
  }

  verifyWebhook(rawBody: string, headers: PineLabsWebhookHeaders, nowSeconds = Math.floor(Date.now() / 1000)): PaymentWebhookEvent {
    if (!headers.id || !headers.timestamp || !headers.signature) throw new PaymentProviderError("Missing Pine Labs webhook headers", 400);
    const timestamp = Number(headers.timestamp);
    if (!Number.isInteger(timestamp) || Math.abs(nowSeconds - timestamp) > this.toleranceSeconds) throw new PaymentProviderError("Pine Labs webhook timestamp is outside the allowed window", 400);
    const signedContent = `${headers.id}.${headers.timestamp}.${rawBody}`;
    const expected = createHmac("sha256", decodeWebhookSecret(this.config.webhookSecret)).update(signedContent).digest("base64");
    if (!constantTimeMatch(expected, signatureCandidates(headers.signature))) throw new PaymentProviderError("Invalid Pine Labs webhook signature", 400);

    let payload: Record<string, unknown>;
    try { payload = jsonObject(JSON.parse(rawBody)); } catch { throw new PaymentProviderError("Invalid Pine Labs webhook JSON", 400); }
    const eventType = String(payload.event_type || "");
    const order = parseOrder(payload.data || {});
    const bookingId = String(order.merchant_order_reference || "");
    const providerOrderId = String(order.order_id || "");
    if (!eventType || !bookingId || !providerOrderId) throw new PaymentProviderError("Incomplete Pine Labs webhook payload", 400);

    return {
      eventId: headers.id,
      bookingId,
      providerOrderId,
      status: mapPineLabsStatus(order.status, eventType),
      reference: paymentReference(order),
      amountMinorUnits: order.order_amount?.value,
      currency: order.order_amount?.currency
    };
  }
}
