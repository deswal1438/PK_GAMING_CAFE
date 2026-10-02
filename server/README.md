# PK Gaming Cafe API

This is the server-side contract behind the static booking experience.

- MongoDB + Mongoose models cover users, configurable resources, services, bookings, packages and blocked slots.
- Prices are read from the `Service` document; the client never controls the final amount.
- An overlap check rejects any active booking on the same resource/date where time ranges intersect.
- `POST /api/payments/webhook/upi` is the payment seam. It verifies an HMAC signature, maps the provider payload and changes a successful booking from `PENDING` to `CONFIRMED`.
- Set `MONGODB_URI`, `ADMIN_API_KEY`, `UPI_WEBHOOK_SECRET` and `UPI_WEBHOOK_SIGNATURE_HEADER` through the deployment environment. Never commit the supplied database password.

Run locally after installing dependencies:

```powershell
Copy-Item .env.example .env
npm install
npm run build
npm run dev
```
