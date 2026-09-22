# Realm Keeper

A self-hosted companion for tabletop RPG game masters. Realm Keeper turns an
Obsidian/Markdown vault into a navigable web wiki for your campaign, and adds
the tools you reach for at the table: interactive maps, perspective scenes,
a 3D dice roller, a music player, and a second screen to show things to your
players.

There is no database. Notes, maps and scenes live as files in a Git
repository; images and audio live in S3-compatible object storage.

## Features

**Notes & wiki**
- Renders a Markdown vault as a browsable wiki, keeping its folder structure
  (`vault/Characters/Hero.md` → `/note/Characters/Hero`).
- Obsidian-style `[[wiki links]]` (`[[Note]]`, `[[Folder/Note]]`,
  `[[Note|custom text]]`), frontmatter, tags and callouts.
- Mermaid diagrams in fenced ` ```mermaid ` blocks.
- Full-text search, tag filtering and a folder tree sidebar.
- Knowledge graph of every note and link (D3 force layout).
- In-browser note editing, committed and pushed back to the vault's Git repo.
- Notes tagged with `NOTE_TAG_IGNORE` (e.g. `draft`) are hidden from the app.

**Inline actions in notes** — inline code spans become interactive:

| Write in a note                          | You get                                  |
| ---------------------------------------- | ---------------------------------------- |
| `` `2d20+5` ``                            | A button that rolls those dice           |
| `` `Action/01 Beyond Distant Lands.mp3` `` | A button that plays that track           |
| `` `chart:regions/tavern-map` ``           | The chart embedded in the note           |
| `` `vista:tavern/night` ``                 | The vista embedded in the note           |

**Game-master tools**
- **Charts** — maps with pins (icon, color, size, linked note), hand-drawn
  paths with direction arrows, and text annotations.
- **Vistas** — perspective scenes: a background plus assets that shrink as
  they move toward a vanishing point, with flip, rotation and color
  adjustments.
- **Asset library** — a reusable, folder-organized image library shared by
  charts and vistas.
- **Dice roller** — physics-based 3D dice (d2 to d100) with standard notation.
- **Music player** — albums and tracks stored in object storage, with a
  sidebar mini-player (shuffle, previous, volume).
- **Player screen** — open `/screen` on a TV or projector; images, charts,
  vistas and dice rolls sent from the GM's view appear there live over
  WebSocket.

Charts, vistas, folders, assets and tracks can all be created, renamed, moved
and deleted from the UI.

**Access control**
- Reading notes, charts, vistas and the screen is public.
- Writes, the music player and screen control require Google login, limited
  to an allow-list of emails. Sessions are signed cookies, no user database.
- Set `ENABLE_AUTH=false` to run it open as a single local user.

## How data is stored

| Data                      | Where                                                      |
| ------------------------- | ---------------------------------------------------------- |
| Notes                     | `.md` files in the vault (a Git repository)                |
| Charts / vistas           | `_charts/<id>/chart.json`, `_vistas/<id>/vista.json` in the vault |
| Images, audio, map icons  | S3-compatible bucket (MinIO, Ceph RGW, AWS S3, …)          |

The backend clones `REPO_URL` on startup, pulls every `GIT_SYNC_INTERVAL`
seconds, and commits and pushes every edit made in the app. You can keep
editing the same vault in Obsidian — both sides stay in sync through Git.

## Quick start (Docker Compose)

Requirements: Docker with Compose.

```bash
cp .env.example .env
docker compose up --build
```

- App: http://localhost:5173
- API docs: http://localhost:8000/docs
- MinIO console: http://localhost:9001 (`minioadmin` / `minioadmin123`)

Compose starts a local MinIO and creates the bucket for you. For a first try
without setting up Google OAuth, add `ENABLE_AUTH=false` to `.env`.

### Using your own vault

Point `REPO_URL` at a Git repository containing your notes. For a private
GitHub repo, create a personal access token with `repo` scope (write access
is needed for in-app edits) and embed it in the URL:

```env
REPO_URL=https://<TOKEN>@github.com/<user>/<notes-repo>.git
```

Without `REPO_URL`, the backend reads whatever is in its `VAULT_PATH`
(`backend/vault/` when running locally).

## Configuration

All settings are environment variables. See [.env.example](.env.example)
and [backend/.env.example](backend/.env.example) for annotated examples.

| Variable                | Default                  | Description                                                      |
| ----------------------- | ------------------------ | ---------------------------------------------------------------- |
| `REPO_URL`              | —                        | Git repository holding the vault                                  |
| `VAULT_PATH`            | `./vault`                | Where the vault is cloned / read from                             |
| `GIT_SYNC_INTERVAL`     | `300`                    | Seconds between pulls (`0` disables periodic sync)                |
| `NOTE_TAG_IGNORE`       | `private`                | Notes with this tag are hidden                                    |
| `S3_ENDPOINT_URL`       | —                        | S3-compatible endpoint                                            |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | —              | Object storage credentials                                        |
| `S3_BUCKET_NAME`        | `realm-keeper-audio`     | Bucket for audio, images and assets                               |
| `S3_REGION`             | `us-east-1`              | Bucket region                                                     |
| `ENABLE_AUTH`           | `true`                   | `false` disables login entirely                                   |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | —    | Google OAuth client (redirect URI: `<backend>/api/auth/callback`) |
| `ALLOWED_EMAILS`        | —                        | Comma-separated emails allowed to log in                          |
| `SESSION_SECRET_KEY`    | random per start         | Signs session cookies — set it in production                      |
| `SESSION_COOKIE_SECURE` | `false`                  | `true` when served over HTTPS                                     |
| `FRONTEND_URL`          | `http://localhost:5173`  | Where to redirect after login                                     |
| `CORS_ALLOWED_ORIGINS`  | `http://localhost:5173`  | Comma-separated allowed origins                                   |
| `LOG_LEVEL`             | `INFO`                   | Backend log level                                                 |
| `VITE_DEFAULT_PAGE`     | `index`                  | Note opened on the home page (frontend build arg)                 |
| `VITE_API_URL`          | empty                    | Backend URL; leave empty when nginx proxies `/api` and `/ws`      |

## Development without Docker

Backend (Python 3.11):

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000 --env-file .env
```

Frontend (Node 20):

```bash
cd frontend
npm install
npm run dev
```

Tests:

```bash
cd backend && pip install pytest && pytest
```

```bash
cd frontend && npx vitest
```

## Deployment

`.argocd/` holds Kubernetes manifests (deployments, services, PDBs, Traefik
ingress, a vault PVC and a Ceph object bucket claim) meant to be synced by
Argo CD. The GitHub Actions workflow bumps `VERSION`, builds both images,
pushes them to `ghcr.io/arnaufauquer/realm-keeper/{backend,frontend}` and
updates the image tags in the manifests.

The backend runs as a single replica: the vault lives on a `ReadWriteOnce`
volume and Git writes are serialized in-process.

## Project structure

```
Realm-Keeper/
├── backend/            FastAPI app
│   ├── main.py         App setup, vault clone/pull loop
│   ├── config/         Settings, logging, cache headers
│   ├── models/         Pydantic models (notes, charts, vistas)
│   ├── routes/         notes, charts, vistas, asset-library, player, screen, auth
│   ├── services/       Markdown parsing, Git commits, S3 storage, JSON document store
│   └── tests/
├── frontend/           Vue 3 + Vite app, served by nginx in production
│   └── src/
│       ├── views/      Home, NoteView, ScreenView
│       ├── components/ Sidebar, modals (graph, charts, vistas, assets, player), dice
│       ├── composables/
│       ├── dice/       three.js + cannon-es dice simulation
│       └── api/
├── .argocd/            Kubernetes manifests
├── .github/workflows/  CI: version bump, image build and push
└── docker-compose.yml  Local stack with MinIO
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for more detail.

## Tech stack

- **Backend:** FastAPI, Pydantic, python-markdown, python-frontmatter, boto3,
  Authlib, Git
- **Frontend:** Vue 3, Vue Router, markdown-it, Mermaid, D3, three.js,
  cannon-es, Axios
- **Infrastructure:** Docker, nginx, MinIO / Ceph RGW, Kubernetes, Argo CD,
  GitHub Actions

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md). To report a vulnerability, follow
[SECURITY.md](SECURITY.md).

## License

[MIT No Attribution (MIT-0)](LICENSE). Use, copy, modify and redistribute it
for any purpose, commercial or not, without even needing to keep the
copyright notice.
