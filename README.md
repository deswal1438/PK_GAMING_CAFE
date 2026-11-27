# PK Gaming Cafe

Public booking-first website and payment-ready backend for **PK Gaming Cafe, Faridabad**.

- Live website: <https://pk-gaming-cafe-auto.yummyherb4.chatgpt.site>
- Public source: <https://github.com/deswal1438/PK_GAMING_CAFE>
- Frontend: static HTML, CSS and JavaScript
- Backend: Node.js, Express, TypeScript, MongoDB and Mongoose
- Recommended online payment provider: Pine Labs Online dynamic UPI QR
- Payment confirmation: signed webhook plus server-side order reconciliation

> Important: repository public hai, lekin payment secrets public nahi hain. Live auto-payment tabhi start hoga jab backend deploy karke Pine Labs UAT/production credentials environment variables mein set kiye jayenge aur `config.js` mein public API URL add hoga.

## Current status

| Component | Status |
| --- | --- |
| Public marketing website | Live |
| Booking UI | Ready |
| Local preview booking | Disabled (fake/local bookings are not accepted) |
| MongoDB booking API | Ready for deployment |
| Pine Labs dynamic UPI QR adapter | Implemented |
| Signed webhook verification | Implemented |
| Duplicate webhook protection | Implemented |
| Amount/order validation | Implemented |
| Public payment-status polling | Implemented with private booking token and automatic Pine Labs reconciliation |
| ₹1 automatic verification demo | Implemented; hidden unless `ENABLE_ONE_RUPEE_DEMO=true` |
| Pine Labs live credentials | Must be supplied by merchant |
| AU Soundbox direct API | Not available from the physical soundbox alone |

## Why Pine Labs is the recommended automatic flow

Pine Labs hardware machine aur Pine Labs Online Gateway do separate products/onboarding paths ho sakte hain.

For a customer booking from another phone/PC, recommended flow:

1. Customer selects rig, date and duration.
2. Backend calculates the final amount from MongoDB; browser amount trusted nahi hota.
3. Backend Pine Labs order and UPI QR payment creates.
4. Website timed dynamic QR shows; mobile users can open the UPI intent directly.
5. Customer scans and authorizes payment in a UPI app.
6. Pine Labs backend webhook sends.
7. Server verifies `webhook-id`, `webhook-timestamp` and `webhook-signature` using HMAC-SHA256.
8. Server booking reference, Pine order ID, INR currency and exact amount match karta hai.
9. Valid `ORDER_PROCESSED` event ke baad hi payment `SUCCESS` aur booking `CONFIRMED` hoti hai.
10. Duplicate webhook event unique event ID se ignore hota hai.
11. Customer status polling automatically Pine Labs Get Order API se re-check karta hai; staff action ki zarurat nahi hoti.

Official references:

- Pine Labs Online docs: <https://www.pinelabs.com/docs/online-payments>
- UPI QR integration: <https://www.pinelabs.com/docs/online-payments/use-cases/accept-payments-upi>
- Webhook signature verification: <https://www.pinelabs.com/docs/online-payments/developer-tools/webhooks/signature-verification>
- Webhook events: <https://www.pinelabs.com/docs/online-payments/developer-tools/webhooks/available-events>
- In-store cloud integration: <https://developer.pinelabs.com/in/instore/cloud-integration>

## AU Small Finance Bank Soundbox reality

AU Soundbox payment voice alert deta hai and AU0101 Business App transaction/settlement view deta hai. Physical soundbox itself website webhook credential nahi hota.

Website booking ko automatically verify karne ke liye AU se merchant-specific integration chahiye, normally one of:

- Dynamic QR API with unique merchant reference
- Server-to-server/H2H collection API
- Signed payment callback/webhook
- Transaction enquiry API

AU relationship manager se written API/onboarding pack milne ke baad separate `AU_BANK_UPI` adapter implement kiya ja sakta hai. Static QR payment, soundbox voice, screenshot or manually typed UTR ko automatic proof of payment treat nahi karna chahiye because exact booking mapping and authenticity guaranteed nahi hoti.

AU product page: <https://www.au.bank.in/business-banking/collection-receivable-solutions/upi-qr-payment>

## Pine Labs machine: in-store option

Agar payment physical cafe counter par Pine Labs terminal se leni hai, Pine Labs Cloud Integration another valid option hai:

1. Server `UploadBilledTransaction` API ko booking number and amount sends.
2. Pine Labs Plutus transaction reference ID returns.
3. Terminal open transaction fetch karta hai or cashier PTR ID enter karta hai.
4. Customer terminal/QR par pays.
5. Backend `GetCloudBasedTxnStatus` polls or Pine Labs callback receives.
6. Approved response ke baad booking confirm hoti hai.

Is flow ke liye Pine Labs integration team se these values/onboarding chahiye:

- Merchant ID
- Security Token
- Store ID
- Client ID/terminal mapping
- UAT device/configuration
- UAT sign-off before production

Current code remote web booking ke liye Pine Labs **Online dynamic UPI QR** implement karta hai. A910S/POS Controller is remote website flow ka part nahi hai.

## Project structure

```text
PK GAMING/
├── index.html                 Public booking website
├── styles.css                 Responsive neon UI
├── app.js                     Booking and payment-return client logic
├── config.js                  Public API base URL only; no secrets
├── admin.html                 Local admin preview
├── admin.js                   Local admin preview logic
├── assets/                    Public image assets
├── dist/                      Static hosting output
├── .openai/hosting.json       Static Sites hosting manifest
└── server/
    ├── .env.example           Safe environment template
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts           API routes and payment state transitions
        ├── payment.ts         Pine Labs OAuth, UPI QR, webhook and status adapter
        ├── payment.test.ts    Signature and UPI QR tests
        ├── models.ts          MongoDB models and webhook idempotency model
        ├── booking.ts         Time calculations and overlap protection
        └── seed.ts            Default rigs, services and prices
```

## Security model

- Client cannot set final price.
- Payment succeeds only after a provider-signed server webhook or automatic server-to-server order reconciliation.
- Webhook uses raw request body.
- HMAC comparison uses constant-time comparison.
- Webhook timestamp tolerance blocks old replay attempts.
- Event ID unique index blocks duplicate processing.
- Booking amount, currency and provider order ID must match.
- A successful payment cannot be downgraded by a later failed event.
- Customer payment status requires a 256-bit private booking token.
- Admin routes require `x-admin-key`.
- Credentials stay in deployment environment variables.
- `.env`, database password, webhook secret and API keys must never be committed.

## Local frontend preview

From project root:

```powershell
node -e "require('http').createServer((req,res)=>{const fs=require('fs');const path=require('path');const f=path.join(process.cwd(),req.url==='/'?'index.html':req.url);fs.createReadStream(f).on('error',()=>{res.statusCode=404;res.end('Not found')}).pipe(res)}).listen(4173,()=>console.log('http://localhost:4173'))"
```

Open <http://localhost:4173>.

With empty `config.js` API URL, frontend safe local-preview mode use karta hai. It does not pretend that a real payment was verified.
It also does not save a fake local booking: the booking button stays disabled until a real HTTPS API URL is configured.

## Backend setup

Requirements:

- Node.js 20+
- MongoDB Atlas or MongoDB replica set
- Pine Labs UAT credentials

Commands:

```powershell
Set-Location server
Copy-Item .env.example .env
npm ci
npm test
npm run build
npm run seed
npm run dev
```

Do not commit `.env`.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | Private MongoDB connection string |
| `PORT` | API port; default `8787` |
| `PUBLIC_ORIGIN` | Exact public frontend origin allowed by CORS |
| `ADMIN_API_KEY` | Long random secret for admin endpoints |
| `PINE_LABS_BASE_URL` | UAT or production Pine Labs base URL |
| `PINE_LABS_CLIENT_ID` | Pine Labs Online client ID |
| `PINE_LABS_CLIENT_SECRET` | Pine Labs Online OAuth client secret |
| `PINE_LABS_WEBHOOK_SECRET` | Base64 webhook signing secret |
| `PINE_LABS_WEBHOOK_TOLERANCE_SECONDS` | Replay window; default `300` |
| `PINE_LABS_CALLBACK_URL` | Success/failure return URL registered for the order |
| `PINE_LABS_QR_TTL_SECONDS` | Website countdown; clamped to 60–1200 seconds, default `600` |
| `ENABLE_ONE_RUPEE_DEMO` | Shows the rate-limited ₹1 verification demo when set to `true` |

## Connect frontend to deployed API

After backend deployment, edit `config.js`:

```js
window.PK_CONFIG = {
  apiBaseUrl: "https://your-api.example.com"
};
```

Never place Pine Labs or MongoDB secrets in `config.js`; browser visitors can read it.

Copy changed frontend files into `dist/` before the next static deployment:

```powershell
Copy-Item index.html,styles.css,app.js,config.js -Destination dist -Force
```

## Pine Labs dashboard configuration

Use UAT first.

1. Get UAT Client ID and Client Secret from Pine Labs Online merchant onboarding/dashboard.
2. Get the webhook signing secret and store it as `PINE_LABS_WEBHOOK_SECRET`.
3. Set webhook URL:

   ```text
   https://your-api.example.com/api/payments/webhook/pine-labs
   ```

4. Enable at least these events:

   - `ORDER_PROCESSED`
   - `PAYMENT_FAILED`
   - `ORDER_FAILED`
   - `ORDER_CANCELLED`
   - `REFUND_PROCESSED`

5. Use a ₹1 UPI QR and verify that the booking changes from `PENDING` to `CONFIRMED` only after a signed success webhook. Pine Labs states that UPI can process real transactions even in UAT, so use the minimum amount.
6. Run negative tests: wrong signature, wrong amount, old timestamp, duplicate event, cancelled order.
7. Request Pine Labs UAT sign-off/production credentials.
8. Change to the exact production base URL supplied by Pine Labs and rotate all test credentials.

## API endpoints

| Method | Endpoint | Use |
| --- | --- | --- |
| `GET` | `/api/health` | Service/payment configuration health |
| `GET` | `/api/resources` | Active rigs |
| `GET` | `/api/services` | Server-priced services |
| `POST` | `/api/bookings` | Create booking and dynamic UPI QR |
| `POST` | `/api/demo-bookings` | Create a rate-limited ₹1 verification QR |
| `POST` | `/api/bookings/:id/payment-session` | Generate a fresh QR with booking token |
| `GET` | `/api/bookings/:id/payment-status` | Private customer status polling |
| `POST` | `/api/payments/webhook/pine-labs` | Signed Pine Labs webhook |
| `GET` | `/api/admin/bookings` | Admin booking list |
| `PATCH` | `/api/admin/bookings/:id/status` | Cancel unpaid or complete verified-paid bookings; cannot confirm payment |

## Production checklist

- [ ] MongoDB production database created
- [ ] Strong admin key generated
- [ ] Pine Labs UAT credentials received
- [ ] Webhook secret stored only in backend environment
- [ ] Backend deployed over HTTPS
- [ ] CORS restricted to public site origin
- [ ] `config.js` points to deployed API
- [ ] Default services seeded
- [ ] Successful UAT payment verified
- [ ] Invalid signature rejected
- [ ] Amount mismatch rejected
- [ ] Duplicate webhook handled once
- [ ] Refund behavior tested
- [ ] Pine Labs production onboarding/sign-off completed
- [ ] Production credentials rotated and activated
- [ ] Live low-value transaction reconciled in merchant dashboard

After this one-time merchant/deployment setup, every payment check and booking confirmation is automatic. Customer support queries may stay on WhatsApp; payment screenshots and staff approval are not part of the flow.

### ₹1 end-to-end verification

Set `ENABLE_ONE_RUPEE_DEMO=true` only in the environment where you want the test button visible, seed the catalogue, and deploy the backend. The demo uses a hidden `DEMO-VERIFY-01` resource, does not reserve a gaming rig, and permits at most three attempts per IP per hour plus one attempt per mobile number every 30 minutes. After the customer scans and pays the ₹1 QR, the normal signed webhook or automatic Get Order reconciliation must change the `DEMO-*` booking from `PENDING` to `CONFIRMED`. Disable the flag after live verification if the public demo is no longer required.

## What must not be done

- Payment screenshot ko automatic confirmation mat treat karo.
- Soundbox voice ko website callback mat treat karo.
- Browser-provided amount or `paymentStatus` trust mat karo.
- Secret/API key frontend JavaScript mein mat rakho.
- UAT credentials production mein mat use karo.
- Webhook signature check skip mat karo.
- Payment callback browser redirect ko success proof mat treat karo; only server verification final hai.
