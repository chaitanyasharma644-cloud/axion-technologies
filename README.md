# Axion Technologies Ltd — Website

A full-stack IT-services company website: a 3D animated frontend (Three.js hero
+ tilting service cards) backed by a real Express server with a working,
validated contact form that's stored in a database and viewable from an admin
dashboard.

## What's actually working here

- **Frontend** (`public/`): static HTML/CSS/JS. Services are fetched from the
  backend (`GET /api/services`), not hardcoded. The contact form does a real
  `fetch()` POST to the backend, shows server-side validation errors inline,
  and shows a success toast on completion. Nav links, mobile menu, and all
  buttons route to real sections/actions — nothing is a dead link.
- **Backend** (`server.js`): Express server with:
  - `GET /api/services` — service list
  - `POST /api/contact` — validates input, rate-limits (5 requests / 15 min /
    IP), and saves the inquiry
  - `GET /api/admin/inquiries` — list saved inquiries (requires admin key)
  - `DELETE /api/admin/inquiries/:id` — delete an inquiry (requires admin key)
  - `GET /api/health` — health check for your hosting platform
- **Database** (`data/inquiries.json`): a simple, dependency-free JSON-file
  store with serialized writes so concurrent submissions can't corrupt it.
  Good for a business-card site like this; see "Swapping in a real database"
  below if you outgrow it.
- **Admin dashboard** (`public/admin.html`): open `/admin.html`, enter your
  admin key, and view/delete submitted inquiries. Not linked from the public
  nav on purpose.

## Run it locally

```bash
npm install
cp .env.example .env    # then edit ADMIN_KEY to something real
npm start
```

Visit `http://localhost:3000`. Admin dashboard: `http://localhost:3000/admin.html`.

For auto-restart on file changes during development:

```bash
npm run dev
```

## Environment variables

| Variable    | Default   | Purpose                                   |
|-------------|-----------|--------------------------------------------|
| `PORT`      | `3000`    | Port the server listens on                 |
| `ADMIN_KEY` | `changeme`| Key required to view/delete inquiries      |

**Set a real `ADMIN_KEY` before deploying** — the server logs a warning on
startup if you leave the default in place.

## Deploying

This is a plain Node.js/Express app, so it runs on any Node host. Three good
free/cheap options:

### Option A — Render
1. Push this folder to a GitHub repo.
2. On Render: New → Web Service → connect the repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Add environment variable `ADMIN_KEY` (and `PORT` isn't needed — Render sets it).
5. **Important**: Render's free filesystem is ephemeral on redeploys. For the
   JSON-file database to persist, add a **Render Disk** mounted at `/app/data`
   (Render dashboard → your service → Disks).

### Option B — Railway
1. Push to GitHub, then "Deploy from GitHub repo" in Railway.
2. Railway auto-detects Node and runs `npm start`.
3. Set `ADMIN_KEY` in the Variables tab.
4. Add a **Volume** mounted at `/app/data` so `inquiries.json` survives deploys.

### Option C — Docker (any VPS, Fly.io, etc.)
```bash
docker build -t axion-site .
docker run -d -p 3000:3000 -e ADMIN_KEY=your-real-key -v axion-data:/app/data axion-site
```
The `-v axion-data:/app/data` volume is what makes inquiries persist across
container restarts — don't skip it.

### A note on serverless (Vercel/Netlify Functions)
Don't deploy this as-is to serverless functions — their filesystem is
read-only/ephemeral, so the JSON database won't persist between requests.
Use Render, Railway, Fly.io, or a regular VPS, or swap in the real database
described below first.

## Swapping in a real database (optional)

The JSON-file store in `server.js` (`readInquiries` / `writeInquiries`) is
intentionally isolated behind two functions. To move to Postgres/SQLite/etc.,
replace just those two functions and the `data/inquiries.json` reads in the
route handlers — the API routes and frontend don't need to change.

## Project structure

```
axion-technologies/
├── server.js              # Express app + API routes
├── package.json
├── .env.example
├── Dockerfile
├── data/
│   └── inquiries.json      # JSON "database" (auto-created if missing)
└── public/
    ├── index.html
    ├── admin.html           # internal dashboard for inquiries
    ├── css/style.css
    └── js/main.js           # 3D hero, tilt cards, dynamic services, form logic
```

## Customizing

- **Services**: edit the array in `server.js` (`GET /api/services`).
- **Colors/fonts**: CSS variables at the top of `public/css/style.css`.
- **Contact details**: footer section in `public/index.html`.
- **Company name/branding**: search for "Axion" / "AXION" across
  `public/index.html` and `public/admin.html`.
