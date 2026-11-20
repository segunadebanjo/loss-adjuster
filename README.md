# Loss Adjuster & Claims Management

Claims management for a Nigerian loss adjusting firm: instructions, inspections, evidence, schedule of loss with
average and excess, sign-off, reports and fee notes. React + Express + Prisma + MySQL. See [CLAUDE.md](CLAUDE.md) for
the architecture, schema, conventions and build phases.

## Run it locally

Requires Node 20+ and Docker.

```sh
docker compose up -d
cp server/.env.example server/.env
cp client/.env.example client/.env
npm install
npm run db:migrate -w server
npm run db:seed -w server
npm run dev
```

Open http://localhost:5174 and sign in as `principal@pinnacle-adjusters.example` with password `Password123!`
(adjuster: `chiamaka.eze@pinnacle-adjusters.example`; insurer: `ngozi.okafor@lagoonassurance.example`).

## Before issuing real documents

Reports and fee notes print the firm's details from the `FIRM_*` settings in `server/.env` (name, address, RC number,
NAICOM licence, contact, TIN, bank account, optional logo). Until they are set, the documents show `[placeholders]`
and principals see a reminder. VAT and WHT rates are `VAT_RATE` and `WHT_RATE`.

Uploads go to `STORAGE_DRIVER` (`cloudinary`, `s3`, or `local` for development); set that service's keys as listed in
`server/.env.example`.

## Checks

```sh
npm test            # server tests against the Docker MySQL
npm run typecheck
npm run lint
npm run build
```
