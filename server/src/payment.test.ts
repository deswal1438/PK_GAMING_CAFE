import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { PaymentProviderError, PineLabsOnlineProvider } from "./payment.js";

const webhookSecret = Buffer.from("test-webhook-secret").toString("base64");

function provider(fetchImpl: typeof fetch = fetch) {
  return new PineLabsOnlineProvider({
    baseUrl: "https://pluraluat.v2.pinepg.in",
    clientId: "client-id",
    clientSecret: "client-secret",
    webhookSecret,
    callbackUrl: "https://example.com/payment-return",
    webhookToleranceSeconds: 300
  }, fetchImpl);
}

test("verifies and maps a Pine Labs ORDER_PROCESSED webhook", () => {
  const body = JSON.stringify({
    event_type: "ORDER_PROCESSED",
    data: {
      order_id: "order-123",
      merchant_order_reference: "PK-2026-ABC123",
      status: "PROCESSED",
      order_amount: { value: 29900, currency: "INR" },
      payments: [{ acquirer_data: { rrn: "123456789012" } }]
    }
  });
  const timestamp = "1700000000";
  const eventId = "event-123";
  const signature = createHmac("sha256", Buffer.from(webhookSecret, "base64")).update(`${eventId}.${timestamp}.${body}`).digest("base64");
  const event = provider().verifyWebhook(body, { id: eventId, timestamp, signature: `v1,${signature}` }, Number(timestamp));

  assert.deepEqual(event, {
    eventId,
    bookingId: "PK-2026-ABC123",
    providerOrderId: "order-123",
    status: "SUCCESS",
    reference: "123456789012",
    amountMinorUnits: 29900,
    currency: "INR"
  });
});

test("rejects stale Pine Labs webhooks", () => {
  const body = JSON.stringify({ event_type: "ORDER_PROCESSED", data: { order_id: "order-1", merchant_order_reference: "booking-1" } });
  assert.throws(
    () => provider().verifyWebhook(body, { id: "event-1", timestamp: "100", signature: "v1,invalid" }, 1000),
    (error) => error instanceof PaymentProviderError && error.message.includes("timestamp")
  );
});

test("creates an idempotent order and a dynamic UPI QR in minor currency units", async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    requests.push({ url, body });
    if (url.endsWith("/api/auth/v1/token")) return new Response(JSON.stringify({ access_token: "token", expires_at: "2099-01-01T00:00:00Z" }), { status: 200 });
    if (url.endsWith("/api/pay/v1/orders")) return new Response(JSON.stringify({ data: { order_id: "order-299" } }), { status: 200 });
    return new Response(JSON.stringify({ data: {
      order_id: "order-299",
      image_url: "https://qr.example/order-299.png",
      challenge_url: "upi://pay?pa=pk@example&am=299.00"
    } }), { status: 200 });
  };

  const order = await provider(fetchImpl).createOrder({
    bookingId: "PK-2026-ABC123",
    amountInRupees: 299,
    customerName: "Amit Deswal",
    customerPhone: "+91 98765 43210",
    customerEmail: "amit@example.com"
  });

  assert.equal(order.providerOrderId, "order-299");
  assert.equal(order.qrImageUrl, "https://qr.example/order-299.png");
  assert.equal(order.upiIntentUrl, "upi://pay?pa=pk@example&am=299.00");
  assert.equal((requests[1]?.body.order_amount as { value: number }).value, 29900);
  assert.equal(requests[1]?.body.merchant_order_reference, "PK-2026-ABC123");
  const payments = requests[2]?.body.payments as Array<Record<string, unknown>>;
  assert.equal((payments[0]?.payment_amount as { value: number }).value, 29900);
  assert.equal(payments[0]?.payment_method, "UPI");
  assert.deepEqual(payments[0]?.payment_option, { upi_details: { txn_mode: "INTENT", upi_qr: true } });
});

test("creates the ₹1 verification demo as exactly 100 paise", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    if (url.endsWith("/api/auth/v1/token")) return new Response(JSON.stringify({ access_token: "token", expires_at: "2099-01-01T00:00:00Z" }), { status: 200 });
    requests.push(body);
    if (url.endsWith("/api/pay/v1/orders")) return new Response(JSON.stringify({ data: { order_id: "order-demo-1" } }), { status: 200 });
    return new Response(JSON.stringify({ data: {
      order_id: "order-demo-1",
      image_url: "https://qr.example/order-demo-1.png",
      challenge_url: "upi://pay?pa=pk@example&am=1.00"
    } }), { status: 200 });
  };

  await provider(fetchImpl).createOrder({
    bookingId: "DEMO-2026-ABC123",
    amountInRupees: 1,
    customerName: "Demo User",
    customerPhone: "9876543210"
  });

  assert.equal((requests[0]?.order_amount as { value: number }).value, 100);
  assert.equal(requests[0]?.merchant_order_reference, "DEMO-2026-ABC123");
  const payments = requests[1]?.payments as Array<Record<string, unknown>>;
  assert.equal((payments[0]?.payment_amount as { value: number }).value, 100);
});
