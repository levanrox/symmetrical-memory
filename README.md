# Symmetrical Memory Workspace

Monorepo workspace hosting the **RingFlow** tournament operations ecosystem and related packages.

---

## Workspace Structure

* 🥋 **[RingFlow-CISCE](./RingFlow-CISCE)**: Real-time tournament floor management and bout scoring system built with Next.js 16, React 19, Tailwind CSS v4, Drizzle ORM, and PostgreSQL. Features live WKF scoring pads, arena TV scoreboards, dynamic ring balancing, and public spectator updates.
  * [RingFlow-CISCE/README.md](./RingFlow-CISCE/README.md) - System overview, roles, architecture, and production deployment.
  * [RingFlow-CISCE/QUICKSTART.md](./RingFlow-CISCE/QUICKSTART.md) - Step-by-step local setup, feature testing guide, and guided tour.
* 🌳 **[silver-meme](./silver-meme)**: Tournament draw generation engine and bracket computation packages.
* 📚 **[skills-mds](./skills-mds)**: Custom agent skill documentation and specifications.

---

## Getting Started

To run RingFlow locally, navigate to `RingFlow-CISCE` and follow the [QUICKSTART.md](./RingFlow-CISCE/QUICKSTART.md):

```bash
cd RingFlow-CISCE
npm install
cp .env.example .env.local
docker compose up -d db
npm run db:push && npm run db:seed
npm run dev
```
