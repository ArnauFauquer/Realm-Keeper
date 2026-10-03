# Realm Keeper

A self-hosted companion for tabletop RPG game masters. Realm Keeper turns an
Obsidian/Markdown vault into a navigable web wiki for your campaign, and adds
the tools you reach for at the table: interactive maps, perspective scenes,
a 3D dice roller, a music player, and a second screen to show things to your
players.

There is no database. Notes, charts and vistas live as files in a Git
repository; encounters, characters' saved values, images and audio live in
S3-compatible object storage.

## Features

**Notes & wiki**
- Renders a Markdown vault as a browsable wiki, keeping its folder structure
  (`vault/Characters/Hero.md` → `/note/Characters/Hero`).
- Obsidian-style `[[wiki links]]` (`[[Note]]`, `[[Folder/Note]]`,
  `[[Note|custom text]]`), frontmatter, tags and callouts.
- Mermaid diagrams in fenced ` ```mermaid ` blocks.
- Full-text search, tag filtering and a folder tree sidebar.
- Constellation: an interactive map of every note and link (D3 force layout on canvas).
- In-browser note editing, committed and pushed back to the vault's Git repo.
- Notes tagged with `NOTE_TAG_IGNORE` (e.g. `draft`) are hidden from the app.

**Inline actions in notes** — inline code spans become interactive:

| Write in a note                          | You get                                  |
| ---------------------------------------- | ---------------------------------------- |
| `` `2d20+5` ``                            | A button that rolls those dice           |
| `` `hf+1d6-1` ``                          | A Hope & Fear roll (plus a d6, minus 1)  |
| `` `adv+5` `` / `` `dis+5` ``             | A d20 with advantage / disadvantage      |
| `` `roll:hf` ``                           | Any formula, made explicit with `roll:` — needed when it's only `hf` / `adv` / `dis` |
| `` `Action/01 Beyond Distant Lands.mp3` `` | A button that plays that track           |
| `` `chart:regions/tavern-map` ``           | The chart embedded in the note           |
| `` `vista:tavern/night` ``                 | The vista embedded in the note           |

**Sheets** — a ` ```sheet ` block in a note (YAML) becomes a character or
adversary sheet: counters, stats, actions with dice buttons. It knows nothing
about any rules system: counters, stats and tags are named by you.

````markdown
```sheet
name: Bugboar
type: adversary            # character | adversary (default: adversary)
subtitle: Tier 1 · Bruiser
image:                     # URL of an asset library image, as copied from the library
tags: [goblinoid]
resources:                 # counters: HP: 6, or { max, min, start, color, style }
  HP: 6
  Stress: { max: 3, start: 0 }   # `start` = where it begins (default: the max)
stats:                     # label: value, or { value, roll } for a dice button
  Difficulty: 14
  Attack: { value: "+2", roll: "hf+2" }
sections:
  - title: Actions
    items:
      - name: Gore
        roll: 1d20+3
        text: "Hits for `1d10+2` damage near [[Goblin Cave]]."
text: |                    # free markdown
  A tusked brute.
```
````

- **`character`** is one individual (a player character, a recurring NPC):
  give it a stable `id` — whatever it saves is kept under that id, so renaming
  or moving its note loses nothing. **`adversary`** is a template: each copy
  in an encounter will have its own values.
- Texts are markdown; an inline dice formula (`` `1d8+2` ``) is a button. Quote
  a text that starts with a `[[link]]`, or YAML reads it as a list.
- A sheet with a mistake shows what is wrong, in the note, instead of the sheet.
  The editor's **Insert** buttons drop a ready-made template at the cursor.
- Sheets work inside callouts too. `GET /api/sheets` lists every sheet in the
  vault (hidden notes excluded).

**Encounters** — who is in a fight, live for everyone at the table. Add
adversaries and characters from their sheets; each one gets counters (HP,
Stress... whatever the sheet defines) with ± buttons, free-text conditions,
notes, an optional initiative, defeated, and its sheet's actions with dice
buttons. A round counter and *Next turn* (it skips the defeated) are there if
you want them, and nothing assumes a rules system.
- Add **3 Bugboars** and each has its own copy of the sheet's counters, starting
  alike and then diverging. A **character** is added once and has no counters of
  its own: its saved values are the same on its note and in every encounter, and
  persist between sessions.
- Everyone signed in can change everything, and sees every change as it is
  made (a WebSocket announces them; there is no Save button). Lose the
  connection and it reloads from the server on reconnecting.
- A sheet's **Add to encounter** button puts it into one without leaving the note.

**Game-master tools**
- **Charts** — maps with pins (icon, color, size, linked note), hand-drawn
  paths with direction arrows, and text annotations.
- **Vistas** — perspective scenes: a background plus assets that shrink as
  they move toward a vanishing point, with flip, rotation and color
  adjustments.
- **Asset library** — a reusable, folder-organized image library shared by
  charts and vistas.
- **Dice roller** — physics-based 3D dice (d2 to d100) with standard notation,
  including subtracted dice (`1d20-1d4`) and Hope & Fear (`hf`): two coloured
  d12s whose sum is a critical on a tie, otherwise "with Hope" or "with Fear"
  depending on which one is higher.
  A natural 20 on a d20 is a critical and a natural 1 a fumble. Advantage /
  disadvantage (`adv` / `dis`) roll two d20 and keep the higher / lower,
  and any group can keep its best or worst dice with `kh` / `kl` (`4d6kh3`).
  A roll throws at most 50 dice. A roll made from a sheet says what it is for
  ("Bugboar · Gore") in the toast and on the screen.
- **Music player** — albums and tracks stored in object storage, with a
  sidebar mini-player (shuffle, previous, volume).
- **Player screen** — open `/screen` on a TV or projector; images, charts,
  vistas and dice rolls sent from the GM's view appear there live over
  WebSocket. In the chart and vista editors, **Go live** mirrors your edits on
  the screen as you make them (drag a pin, move an asset), saved or not;
  turning it off with unsaved changes puts the saved version back.
  The Constellation works the same way: **Send to screen** shows it frozen as it
  is, and **Go live** mirrors your zoom, pan, dragged notes and highlights.

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
| Encounters                | `docs/encounters/<folders>/<id>/encounter.json` in the bucket |
| Characters' saved values  | `docs/characters/all/characters.json` in the bucket        |
| Images, audio, map icons  | S3-compatible bucket (MinIO, Ceph RGW, AWS S3, …)          |

The backend clones `REPO_URL` on startup, pulls every `GIT_SYNC_INTERVAL`
seconds, and commits and pushes every edit made in the app. You can keep
editing the same vault in Obsidian — both sides stay in sync through Git.

Encounters and characters are not in Git: they change while people play, and the
vault is a throwaway clone that a redeploy replaces. They are JSON objects in the
bucket, held in memory while someone is using them and written a couple of
seconds after the last change (and when the app shuts down). Without an S3
endpoint they go to `DOCS_LOCAL_PATH` instead, for local development. Don't
redeploy in the middle of a session: the new pod would load the last saved copy.

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
| `DOCS_LOCAL_PATH`       | `./docs-data`            | Where encounters and characters are kept when there is no `S3_ENDPOINT_URL` |
| `ENABLE_AUTH`           | `true`                   | `false` disables login entirely                                   |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | —    | Google OAuth client (redirect URI: `<backend>/api/auth/callback`) |
| `ALLOWED_EMAILS`        | —                        | Comma-separated emails allowed to log in; each one's position sets their dice colour |
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
Argo CD.

Releases are managed by
[release-please](https://github.com/googleapis/release-please): on every
push to `main` it keeps a release PR open that bumps `VERSION`, the image
tags in `.argocd/` and `CHANGELOG.md`, based on the Conventional Commits
merged since the last release. Merging that PR tags `vX.Y.Z` and builds both
images to `ghcr.io/arnaufauquer/realm-keeper/{backend,frontend}`.

The backend runs as a single replica: the vault lives on a `ReadWriteOnce`
volume and Git writes are serialized in-process.

## Project structure

```
Realm-Keeper/
├── backend/            FastAPI app
│   ├── main.py         App setup, vault clone/pull loop
│   ├── config/         Settings, logging, cache headers
│   ├── models/         Pydantic models (notes, charts, vistas)
│   ├── routes/         notes, sheets, encounters, characters, sync, charts, vistas, asset-library, player, screen, auth
│   ├── services/       Markdown + sheet parsing, Git commits, S3 storage, JSON documents (doc_*, sync_hub)
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
