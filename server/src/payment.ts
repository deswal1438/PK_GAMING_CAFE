import { createHmac, timingSafeEqual } from "node:crypto";

export type PaymentStatus = "PENDING" | "SUCCESS" | "FAILED" | "REFUNDED";
export type PaymentWebhookEvent = { bookingId: string; status: PaymentStatus; reference?: string; amount?: number };

export interface PaymentProvider {
  createOrder(input: { bookingId: string; amount: number; customerPhone: string }): Promise<{ providerOrderId: string; checkoutUrl?: string }>;
  verifyWebhook(rawBody: string, signature: string): PaymentWebhookEvent;
}

/** UPI webhook-first adapter. Provider-specific payload mapping stays here. */
export class UpiWebhookProvider implements PaymentProvider {
  constructor(private readonly secret: string) {}

  async createOrder(input: { bookingId: string; amount: number; customerPhone: string }) {
    return { providerOrderId: `UPI-${input.bookingId}`, checkoutUrl: undefined };
  }

  verifyWebhook(rawBody: string, signature: string): PaymentWebhookEvent {
    const expected = createHmac("sha256", this.secret).update(rawBody).digest("hex");
    const expectedBuffer = Buffer.from(expected, "utf8");
    const receivedBuffer = Buffer.from(signature, "utf8");
    if (expectedBuffer.length !== receivedBuffer.length || !timingSafeEqual(expectedBuffer, receivedBuffer)) throw new Error("Invalid UPI webhook signature");
    const payload = JSON.parse(rawBody) as { bookingId?: string; status?: PaymentStatus; reference?: string; amount?: number };
    if (!payload.bookingId || !payload.status) throw new Error("Invalid UPI webhook payload");
    return { bookingId: payload.bookingId, status: payload.status, reference: payload.reference, amount: payload.amount };
  }
}
