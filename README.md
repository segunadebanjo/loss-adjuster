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

## Put it online (Render)

One Render **Web Service** runs both the API and the web app (in production the API serves `client/dist`).

| Setting | Value |
| --- | --- |
| Root Directory | _(leave blank)_ |
| Build Command | `npm ci --include=dev && npm run db:generate -w server && npm run build` |
| Start Command | `npm run start:prod -w server` |
| Health Check Path | `/health` |

`start:prod` applies the database migrations, then (only while the database has no users) loads the demo data or creates
the first admin, then starts the server. Environment variables:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | a MySQL 8 URL (Render has no MySQL: use e.g. Aiven's free MySQL; add `?sslaccept=accept_invalid_certs` if it needs SSL with its own certificate) |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | two different random strings of 32+ characters |
| `STORAGE_DRIVER` | `cloudinary`, with `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` |
| `LOAD_DEMO_DATA` | `true` to fill an empty database with the fictional demo data (set `SEED_PASSWORD` to choose its password) |
| or `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | to start empty with one Principal Adjuster instead |
| `FIRM_*` | the firm's details for reports and fee notes |

Neither first-start option does anything once a user exists, so they never touch real data.

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
