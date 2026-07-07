# ApplyFlow

ApplyFlow is a job-search and career-change CRM for tracking applications,
selection stages, interview candidates, deadlines, waiting replies, and schedule
conflicts.

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS and shadcn-style local UI components
- Auth.js with Google OAuth
- Prisma and PostgreSQL
- FullCalendar
- Vitest

## Local Setup

```bash
npm install
cp .env.example .env.local
docker compose up -d
npm run prisma:migrate
npm run dev
```

Set `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, and `AUTH_SECRET` in `.env.local`
before testing Google login.

## MVP Scope

v0.1 intentionally excludes Google Calendar, Gmail, notifications, and AI
extraction. The implemented scope is manual CRM entry, proposed interview slots,
deadlines, waiting replies, activity logs, an internal calendar, and conflict
warnings.
