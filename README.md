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

## Checks

```sh
npm test            # server tests against the Docker MySQL
npm run typecheck
npm run lint
npm run build
```
