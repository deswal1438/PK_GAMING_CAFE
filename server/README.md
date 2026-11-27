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

Server MongoDB se price calculate karta hai, overlapping bookings block karta hai, Pine Labs hosted checkout session creates, signed raw-body webhook verify karta hai, order/currency/amount validate karta hai, duplicate events block karta hai and token-protected customer payment status expose karta hai. Pending status checks Pine Labs Get Order API se automatically reconcile hote hain; staff payment confirmation endpoint available nahi hai.

Optional ₹1 end-to-end test ke liye `ENABLE_ONE_RUPEE_DEMO=true` set karke seed run karein. Hidden demo resource kisi gaming slot ko reserve nahi karta; successful signed verification ke baad hi `DEMO-*` booking confirm hoti hai.

Production webhook:

```text
POST https://your-api.example.com/api/payments/webhook/pine-labs
```

`.env`, MongoDB credentials, Pine Labs secrets aur admin keys Git ke bahar rakhein.
