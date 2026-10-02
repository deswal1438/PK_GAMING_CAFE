# PK Gaming Cafe

Premium booking-first website for PK Gaming Cafe, Faridabad.

## Included

- Neon black / orange / blue visual system based on the supplied PK references.
- Mobile-first booking form with configurable rigs, server-priced service mapping and local overlap prevention for preview.
- Pricing for PS5, racing simulator, PS5 + VR, Meta VR cricket, all-access pass and birthday packages.
- Admin dashboard preview for searching booking IDs/mobile numbers, status changes and basic stats.
- TypeScript API scaffold using MongoDB + Mongoose, rate limiting, input validation, server-side price calculation and resource-level overlap rejection.
- UPI webhook-first payment abstraction with HMAC verification. Payment remains `PENDING` until your provider webhook confirms it.

## Local preview

```powershell
node -e "require('http').createServer((req,res)=>{const fs=require('fs');const path=require('path');const f=path.join(process.cwd(),req.url==='/'?'index.html':req.url);fs.createReadStream(f).on('error',()=>{res.statusCode=404;res.end('Not found')}).pipe(res)}).listen(4173,()=>console.log('http://localhost:4173'))"
```

Then open `http://localhost:4173`.

## Production API

See [`server/README.md`](server/README.md) and copy [`server/.env.example`](server/.env.example) to a private `.env`. The MongoDB password supplied for this project is intentionally not stored in the repository.
