# Mini Kanban Board

A collaborative kanban application for organizing work across boards, columns, and tasks — with live multi-user updates, role-based board sharing, and a full activity history of every change.

It is built as a small full-stack project: a Next.js frontend on the client side and an Express API on the server, with PostgreSQL holding the data through Prisma. The two sides talk over a standard REST API, and in development the Next.js dev server proxies API calls so the application feels like a single same-origin app during local work.

## Tech stack

The project uses TypeScript on both the frontend and the backend, which keeps the domain model consistent from the database schema up through the UI components.

**Frontend** — Next.js 16 with React 19, Tailwind CSS 4, and TypeScript. The app is a set of pages and server/client components that render the board list, the kanban board, the task dialog, the activity feed panel, the members panel, and a real-time connection indicator. Drag-and-drop on the board uses the native HTML5 drag-and-drop API, with optimistic UI updates that reconcile against the server afterward.

**Backend** — Express 5 with TypeScript, Prisma as the ORM, and PostgreSQL 16 as the database. The API follows a conventional REST shape: authentication under `/api/auth`, boards and their contents under `/api/boards`, and a real-time stream also under `/api/auth` because the refresh cookie that authenticates it is path-scoped there. Security middleware includes Helmet for headers, strict CORS allowed only for the configured frontend origin, rate limiting on the auth endpoints and the wider API surface, and a centralized error handler that returns structured error objects.

**Why these choices** — Next.js gives a fast, convention-driven frontend with server components and easy deployment paths; Express is lightweight and familiar for a focused JSON API; Prisma gives type-safe database access from a clear schema; PostgreSQL is the right store for relational board data; and Docker Compose makes the database and backend easy to run together locally and in CI.

## Architecture

The application is split into three concerns: the database schema, the backend API, and the frontend UI.

### Database

The Prisma schema models the whole domain: users, boards, board membership with roles, columns, tasks, comments, and an audit event table that records nearly every mutation. Tasks use a fractional `position` column so cards can be reordered and moved between columns without renumbering the whole column each time. The audit events are the backbone of two features: the activity feed on each board, and the real-time stream that notifies live viewers when something changes.

### Authentication

Authentication uses two JWTs. A short-lived access token is used for API calls that need a Bearer token, and a longer-lived refresh token is stored in an HttpOnly cookie scoped to `/api/auth`. The refresh endpoint rotates the cookie and returns a fresh access token. Logout clears the cookie. The `/me` endpoint returns the current user from the access token.

### Authorization and board sharing

Every board has an owner. Other users can be invited by email and assigned one of three roles: OWNER, EDITOR, or VIEWER. The backend enforces these roles on every protected route. VIEWER can read the board and its contents but cannot create or modify anything. EDITOR can create and edit columns, tasks, and comments. Only the OWNER can invite members, change roles, remove members, or delete the board. Board deletion cascades members, columns, tasks, comments, and the board's audit history.

### Activity feed

Every significant change — board create and update, column create/update/delete, task create/update/move/delete, member add/role change/remove, and comment add — is recorded as an audit event attached to the board. The activity feed endpoint returns these events in descending time order with keyset pagination, so a client can load the latest events and then keep walking backward through history using a cursor.

### Real-time updates

When a mutation is recorded as an audit event, the backend publishes a change message to everyone currently watching that board's stream. The frontend subscribes to the stream using Server-Sent Events and silently refreshes the board when it receives a change. If the user has an in-flight drag move, the board's own settle re-sync handles that instead of a competing refresh. If a teammate deletes the task the user has open in the dialog, the dialog closes automatically. The stream authenticates through the refresh cookie rather than a Bearer header, which is why the endpoint lives under `/api/auth`.

## Getting started

### Prerequisites

- Node.js 22 or newer
- npm
- A PostgreSQL database, or Docker to run one

### Clone and install

Clone the repository and install the dependencies in both the backend and the frontend.

```
git clone https://github.com/soumik171/Mini-Kanban-Board.git
cd Mini-Kanban-Board
```

The backend dependencies live in `backend/package.json`, and the frontend dependencies live in `frontend/package.json`. Install each with `npm install` from the appropriate directory, or use the combined docker-compose flow described below.

### Environment setup

Copy the example environment file in the backend and fill in the values you want for your run. The backend `.env.example` documents the variables the server expects. The critical ones are the database URL, the port, the frontend origin for CORS, and the two JWT secrets.

For a local development run, the defaults in the code are usable as-is, but in any shared or deployed environment you should set real secrets. The two JWT secrets, `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`, must be set in production or the server will refuse to start.

The frontend reads `BACKEND_URL` to know where to send API requests in production. In development the Next.js rewrite maps `/api/*` to the backend at `http://localhost:4000`, so the frontend usually does not need a separate backend URL variable while you are working locally.

### Database

The fastest way to get a database running locally is Docker Compose, which starts PostgreSQL and the backend together:

```
docker compose up
```

This starts a Postgres 16 instance and the Express API. The API waits for the database to be healthy before it starts. The database data is persisted in a named volume so it survives restarts.

If you prefer to run PostgreSQL on its own, create a database and set `DATABASE_URL` in the backend environment to point at it, for example:

```
DATABASE_URL=postgresql://kanban:kanban_dev_password@localhost:5432/kanban?schema=public
```

Once the database is reachable, generate the Prisma client and apply the migrations from the `backend` directory:

```
cd backend
npx prisma generate
npx prisma migrate deploy
```

### Seed the demo data

The project includes a seed script that creates two demo accounts and a shared board pre-populated with columns, tasks, a cross-column move, and a short comment thread. This gives the UI something realistic to render from the first run.

Run it from the `backend` directory:

```
cd backend
npm run db:seed
```

The seed is idempotent — if the "Demo Kanban" board already exists for the demo user, it skips creation. The demo credentials it creates are:

- **demo@test.com** / `demo-password-1` — board owner
- **teammate@test.com** / `demo-password-1` — invited as an editor

### Run the application

With the database running and migrations applied, you can run the backend and frontend together locally. The typical development flow is two terminals.

In the first terminal, start the backend:

```
cd backend
npm run dev
```

The API listens on port 4000 by default and serves `/health` for a quick liveliness check.

In the second terminal, start the frontend:

```
cd frontend
npm run dev
```

The Next.js dev server runs on port 3000 and proxies `/api/*` requests to the backend, so the frontend and backend behave as if they are on the same origin during development. Open `http://localhost:3000` in the browser.

If you started everything with Docker Compose, the backend is already running on port 4000. In that case you only need to start the frontend separately with `npm run dev` from the `frontend` directory, or build and run it with `npm run build` followed by `npm run start` once you are ready to serve the production build.

## API overview

The backend exposes a JSON API. All authenticated routes expect either a Bearer access token or the refresh cookie where applicable. Unauthenticated requests to protected endpoints receive a 401 response with a structured error object.

### Authentication

- `POST /api/auth/register` — create an account with email, name, and password
- `POST /api/auth/login` — log in and receive the refresh cookie plus the current user
- `POST /api/auth/refresh` — rotate the refresh cookie and return a new access token
- `POST /api/auth/logout` — clear the refresh cookie
- `GET /api/auth/me` — return the current user from the access token
- `GET /api/auth/stream?boardId=...` — Server-Sent Events stream for a board, authenticated via the refresh cookie

### Boards

- `GET /api/boards` — list the boards the current user owns or is a member of
- `POST /api/boards` — create a board (owner only, authenticated)
- `GET /api/boards/:boardId` — board detail, requires board access
- `PATCH /api/boards/:boardId` — update title or description, requires EDITOR or higher
- `DELETE /api/boards/:boardId` — delete the board, requires OWNER
- `GET /api/boards/:boardId/members` — list members with roles
- `POST /api/boards/:boardId/members` — invite a user by email with a role, requires OWNER
- `PATCH /api/boards/:boardId/members/:userId` — change a member's role, requires OWNER
- `DELETE /api/boards/:boardId/members/:userId` — remove a member, requires OWNER
- `GET /api/boards/:boardId/activity` — activity feed with keyset pagination

### Board contents

Columns, tasks, and comments live under the board router at `/api/boards/:boardId`. The available operations cover creating, reading, updating, and deleting columns and tasks, reordering and moving tasks between columns, and adding and deleting comments. Move operations record a `TASK_MOVED` audit event so the activity feed and the real-time stream both reflect the change.

## Development workflow

The project is written in TypeScript on both sides, with type checking as part of the normal edit loop.

From the `backend` directory:
- `npm run typecheck` — run TypeScript without emitting files
- `npm run lint` — run ESLint
- `npm run format` — format with Prettier
- `npm run test` — run the Vitest test suite
- `npm run build` — compile the production bundle
- `npm run dev` — run with hot reload using tsx
- `npm run db:seed` — run the seed script

From the `frontend` directory:
- `npm run dev` — run the Next.js dev server
- `npm run build` — build the production application
- `npm run start` — serve the production build
- `npm run lint` — run ESLint

Prisma workflows from the `backend` directory:
- `npx prisma generate` — generate the client from the schema
- `npx prisma migrate deploy` — apply pending migrations
- `npx prisma migrate dev` — develop with migrations

## CI

Continuous integration runs on every push and pull request to the main branch. The GitHub Actions workflow checks out the code, sets up Node 22, installs dependencies, generates the Prisma client, applies migrations against an in-CI PostgreSQL service, and then runs the typecheck, lint, and test steps. The test job runs the backend Vitest suite against a real Postgres instance so the tests exercise the database layer rather than mocks.

The CI is scoped to the backend today. The frontend is built and typechecked as part of local development and the production build step; adding a dedicated frontend CI job is a natural next step once the frontend has its own test surface.

## Deployment

The current deployment story centers on Docker Compose, which runs the database and the backend API as a single unit. The `docker-compose.yml` at the repository root defines two services: a Postgres 16 database with a health check and a persistent volume, and the backend API built from `backend/Dockerfile`. The API receives the database URL and port through environment variables and depends on the database being healthy before it starts.

The frontend is not yet part of the Compose file. In its current form, the intended production shape is: run the database and backend through Compose, build the Next.js frontend with `npm run build`, and serve it with `npm run start` (or a separate web server such as nginx) configured to proxy API requests to the backend. In development, the Next.js rewrite handles this proxying automatically.

To deploy the backend via Compose, set the required environment variables — at minimum `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, and optionally `CLIENT_ORIGIN` and `PORT` — and run `docker compose up -d`. The backend image runs `prisma migrate deploy` on startup before starting the server, so the database schema is applied as part of the boot sequence.

For a fully self-contained deployment, the remaining work is to add a frontend service to Compose (or a static hosting path for the built Next.js output) and to wire production environment variables for both sides. Once that is in place, the application can be started from a single Compose file with both the UI and the API.

## Repository structure

```
/
├── backend/
│   ├── src/               # Express API: app, routes, middleware, lib
│   ├── prisma/
│   │   ├── schema.prisma  # data model
│   │   └── seed.ts        # demo seed script
│   ├── Dockerfile         # multi-stage build for the API
│   └── package.json
├── frontend/
│   ├── src/               # Next.js app, components, lib
│   ├── next.config.ts     # dev-server API proxy
│   └── package.json
├── docker-compose.yml     # Postgres + API services
├── .env.example           # sample backend environment
└── README.md
```

## License

This project is a personal portfolio exercise and is shared as-is.
