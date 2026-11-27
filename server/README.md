# PK Gaming Cafe API

Production-oriented booking and Pine Labs Online payment verification API. Complete setup, payment flow, environment reference and go-live checklist repository root [`README.md`](../README.md) mein documented hain.

## Quick start

```powershell
Copy-Item .env.example .env
npm ci
npm test
npm run build
npm run seed
npm run dev
```

Server MongoDB se price calculate karta hai, overlapping bookings block karta hai, Pine Labs hosted checkout session creates, signed raw-body webhook verify karta hai, order/currency/amount validate karta hai, duplicate events block karta hai and token-protected customer payment status expose karta hai.

Production webhook:

```text
POST https://your-api.example.com/api/payments/webhook/pine-labs
```

`.env`, MongoDB credentials, Pine Labs secrets aur admin keys Git ke bahar rakhein.
