# Realm Keeper

A self-hosted companion for tabletop RPG game masters. Realm Keeper turns an
Obsidian/Markdown vault into a navigable web wiki for your campaign, and adds
the tools you reach for at the table: interactive maps, perspective scenes,
a 3D dice roller, a music player, and a second screen to show things to your
players.

There is no database. Notes live as files in a Git repository; everything else
(charts, vistas, encounters, battlemaps, characters' saved values, images and
audio) lives in S3-compatible object storage.

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
  A sheet is plain YAML: no aliases (`*name`, which can expand to gigabytes) and
  at most 100 KB.
- Sheets work inside callouts too. `GET /api/sheets` lists every sheet in the
  vault (hidden notes excluded).

**Encounters** — who is in a fight, live for everyone at the table. Add
adversaries and characters from their sheets; each one gets counters (HP,
Stress... whatever the sheet defines) with ± buttons, free-text conditions,
notes, defeated, and its sheet's actions with dice buttons. There are no
rounds, turns or initiative, since how a fight is ordered is a rule of the
system being played: drag the combatants (or use the arrows) into whatever
order suits your table.
- Add **3 Bugboars** and each has its own copy of the sheet's counters, starting
  alike and then diverging. A **character** is added once and has no counters of
  its own: its saved values are the same on its note and in every encounter, and
  persist between sessions.
- Everyone signed in can change everything, and sees every change as it is
  made (a WebSocket announces them; there is no Save button). Lose the
  connection and it reloads from the server on reconnecting.
- A sheet's **Add to encounter** button puts it into one without leaving the note.

**Battlemaps** — a tactical map to play a fight out on, shared live like an
encounter. Pick a map image from the asset library and lay a grid over it
(cell size and offset in pixels of the image, snapping on or off). Tokens are
placed in cells, so changing the grid never moves anyone; drag them, resize
them, give them an image or a colour. A **ruler** measures between cells: you
say what one cell is worth (5 ft, 1.5 m, 1 square…) and whether a diagonal
costs one cell or its length.
- Attach an **encounter** and *Place combatants* puts a token for each one. A
  token can show some of its combatant's counters as bars (an adversary's own,
  or a character's saved ones), and they follow the encounter as it changes.
- **Hidden** tokens are dimmed for everyone signed in and **never sent to the
  screen**: *Show on the screen* sends the server's view of the map, made
  without them (and without which sheet or combatant a token stands for). The
  screen follows every change — moves, new tokens, counters — a moment later.
- Everyone signed in can move any token and change any setting.

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
  A battlemap shown on the screen is always live, without its hidden tokens.

Charts, vistas, folders, assets and tracks can all be created, renamed, moved
and deleted from the UI.

**Access control**
- Reading notes (and the sheets written in them) is public.
- Everything else — charts, vistas, encounters, battlemaps, the asset library,
  the music player, writing and screen control — requires Google login, limited
  to an allow-list of emails. Sessions are signed cookies, no user database.
- A paired screen (`/screen#key=…`, a TV or OBS source with no login) can read
  only what is on it right now: the chart or vista last sent and the images it
  draws, nothing else.
- Set `ENABLE_AUTH=false` to run it open as a single local user.

## How data is stored

| Data                      | Where                                                       |
| ------------------------- | ----------------------------------------------------------- |
| Notes                     | `.md` files in the vault (a Git repository)                 |
| Audio (the player)        | `player/<album>/<track>` in the bucket                      |
| Images (asset library)    | `asset-library/<folders>/<image>` in the bucket             |
| Charts                    | `charts/<folders>/<id>/chart.json` in the bucket            |
| Vistas                    | `vistas/<folders>/<id>/vista.json` in the bucket            |
| Encounters                | `encounters/<folders>/<id>/encounter.json` in the bucket    |
| Battlemaps                | `battlemaps/<folders>/<id>/battlemap.json` in the bucket    |
| Characters' saved values  | `characters/<sheet id>/character.json` in the bucket        |

The bucket is any S3-compatible store (MinIO, Ceph RGW, AWS S3, …) with one
top-level prefix per kind of thing, and nothing else at the top.

The backend clones `REPO_URL` on startup, pulls every `GIT_SYNC_INTERVAL`
seconds, and commits and pushes every edit made to a note in the app. You can
keep editing the same vault in Obsidian — both sides stay in sync through Git.

Everything else is not in Git: the vault is a throwaway clone that a redeploy
replaces, and a map or a fight changes while people play. Those documents are
JSON objects in the bucket, one `PUT` per save, with no lock and no commit.
Charts and vistas are edited whole and saved with a button; encounters,
battlemaps and characters are *live*: held in memory while someone is using them
and written a couple of seconds after the last change (and when the app shuts
down). Without an S3 endpoint the documents go to `DOCS_LOCAL_PATH` instead (the
same prefixes, as folders), for local development. Don't redeploy in the middle of a session: the new pod would
load the last saved copy.

**Coming from a vault that kept charts and vistas in Git** (`_charts/` and
`_vistas/`, how earlier versions stored them): on its first start the backend
copies them into the bucket, once per kind. Nothing in the vault is changed or
deleted, and a document already in the bucket is never replaced, so the copy is
safe to repeat. Once you have checked the charts and vistas in the app, delete
`_charts/` and `_vistas/` from the vault repository yourself. Their history in
Git is gone from the app's point of view: to keep an undo trail for the bucket,
turn on **bucket versioning** (`aws s3api put-bucket-versioning --bucket <bucket>
--versioning-configuration Status=Enabled`, if your Ceph RGW or MinIO supports it).

**Moving a bucket that has the older layout** (albums at the top level, documents
under `docs/`, and `charts/`/`vistas/` holding images): `backend/scripts/migrate_storage_layout.py`
does it once, for any bucket, and can then be deleted. It reads the same `S3_*`
settings as the app and shows what it would do unless told otherwise:

```bash
cd backend
python scripts/migrate_storage_layout.py               # dry run: what goes where, and any conflict
python scripts/migrate_storage_layout.py --copy-only   # copy and check; the old keys stay
python scripts/migrate_storage_layout.py --apply       # copy, check, delete the old keys
```

Nothing is overwritten and nothing is deleted before its copy is checked, so a run
that stops halfway can be run again. The old `charts/` and `vistas/` images (from
before the asset library) go to `asset-library/Legacy/`, and the documents that
still name one by its old URL are pointed at the new place. `asset-library/` keeps
its name because notes and documents refer to its images by URL.

For a live deployment: run `--copy-only` while the old version is still serving
(it keeps working, the copies sit beside the originals), deploy the new version,
then run `--apply` to move what was written in between and remove the old keys.
Run it against the same bucket the app uses, from a shell with its `S3_*` settings
(for Kubernetes, `kubectl exec` into the backend pod: the script is in the image).

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
| `DOCS_LOCAL_PATH`       | `./docs-data`            | Where charts, vistas, encounters, battlemaps and characters are kept when there is no `S3_ENDPOINT_URL` |
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
volume, Git writes are serialized in-process and live documents are held in that
one process's memory.

## Project structure

```
Realm-Keeper/
├── backend/            FastAPI app
│   ├── main.py         App setup, vault clone/pull loop
│   ├── config/         Settings, logging, cache headers
│   ├── models/         Pydantic models (notes, sheets, charts, vistas, encounters, battlemaps)
│   ├── routes/         notes, sheets, encounters, battlemaps, characters, sync, charts, vistas, asset-library, player, screen, auth
│   ├── services/       Markdown + sheet parsing, Git commits, S3 storage, JSON documents (doc_*, sync_hub)
│   ├── scripts/        One-time tools (migrate_storage_layout.py)
│   └── tests/
├── frontend/           Vue 3 + Vite app, served by nginx in production
│   └── src/
│       ├── views/      Home, NoteView, ScreenView
│       ├── components/ Sidebar, document modal (charts, vistas, encounters, battlemaps), graph, assets, player, dice
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
