# Realm Keeper

A self-hosted companion for tabletop RPG game masters. Realm Keeper turns an
Obsidian/Markdown vault into a navigable web wiki for your campaign, and adds
the tools you reach for at the table: interactive maps, perspective scenes,
a 3D dice roller, a music player, and a second screen to show things to your
players.

There is no database. Notes live as files in a Git repository; everything else
(charts, vistas, characters, adversaries, encounters, battlemaps, images and
audio) lives in S3-compatible object storage.

## Features

**Notes & wiki**
- Renders a Markdown vault as a browsable wiki, keeping its folder structure
  (`vault/Characters/Hero.md` → `/note/Characters/Hero`).
- Obsidian-style `[[wiki links]]` (`[[Note]]`, `[[Folder/Note]]`,
  `[[Note|custom text]]`), frontmatter, tags and callouts.
- Mermaid diagrams in fenced ` ```mermaid ` blocks.
- Search (Ctrl+K, or Cmd+K on a Mac) across the notes and, signed in, everything
  in the Observatory: documents of every kind and images, by name, folder,
  subtitle or tag. Tag filtering and a folder tree sidebar.
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
| `` `sfx:Effects/door creak.mp3` ``         | A sound effect played over the music (press again to cut it) |
| `` `chart:regions/tavern-map` ``           | The chart embedded in the note           |
| `` `vista:tavern/night` ``                 | The vista embedded in the note           |
| `` `character:party/aria` ``               | The character's sheet, its counters live |
| `` `adversary:bestiary/bugboar` ``         | The adversary's sheet                    |

**Roll tables**: a table whose first header cell is a die rolls on itself.
Press the die to throw it; the row it lands on is highlighted, and the toast
says what it reads (only on your screen: the player screen shows the dice).

```markdown
| d6  | Weather          |
| --- | ---------------- |
| 1-3 | Rain             |
| 4-5 | Fog              |
| 6   | Clear skies      |
```

- The first column holds each row's numbers: `7`, a range `2-3`, `96-00`
  for a `d%`, or `11+`. Rows without numbers are counted from 1.
- Any die works: `d20`, `2d6`, `d%`. A bare `d` sizes the die to the table:
  a 20-row table rolls a d20.
- A die there's no real die for (a 7-row table, `d3`) picks a row at random.

**Sheets** — characters and adversaries, each a document of its own (in
folders, like charts and vistas): counters, stats, actions with dice buttons.
A sheet knows nothing about any rules system: counters, stats and tags are
named by you.

- A **character** is one individual (a player character, a recurring NPC):
  its counters keep their values wherever it shows — on every note, in every
  encounter and on every map — and between sessions. Its counters change live,
  like an encounter's; the sheet itself is saved with the editor's **Save**.
  An **adversary** is a template: each copy in an encounter will have its own
  values. It is edited whole and saved with a button, like a chart.
- Create one from the Observatory (**New ▾ → Character** or **Adversary**, or
  the sidebar's shortcut to that kind) and build it in the **sheet
  builder**, beside a live preview; an empty sheet offers **Start from a
  template**. No format to learn: everything is a form.
- To show one in a note, write its link, `` `character:<id>` `` or
  `` `adversary:<id>` `` (see the table above): the note editor's **Sheet**
  button finds one and inserts it, and the editor's copy button gives it too.
  A character's counters there are live and can be played from the note. Under
  the sheet, **Edit** opens it in its editor and **Add to encounter**
  puts it into one without leaving the note. A sheet named like its note's
  title or one of its headings doesn't repeat the name in its header (screen
  readers still get it).
- **Moving** a character or adversary — or renaming or moving its folder —
  changes its id: the links in the notes that show it are rewritten (in one
  commit), and the encounters and map tokens that use it follow. Renaming it
  only changes the name it shows.

What the sheet builder edits:

- **Header**: a portrait (picked from the Observatory), a subtitle and tags.
  The name, id and type are the document's: the name is the one given in the
  gallery (rename it there), the id is where it is stored, and the type is
  whether it is a character or an adversary.
- **Sections** hold everything, in order: add one, give it a title (or none:
  an untitled section opens the sheet), and drag it by its handle (or press
  ↑/↓ on the handle) to reorder. Each section draws its **counters**, then its
  **stats**, then its **entries**, so spell slots can sit with their spells.
- **Counters** have a name, a maximum, a minimum, where they **start** (the
  maximum unless said otherwise, so one can count up from 0), how they are
  shown (pips, a bar or a number) and a colour. Their names are unique in the
  sheet: characters and encounters go by them.
- **Stats** come in groups, each with an optional title and a number per row:
  a label, a value and, for a dice button, a roll. A value typed as a whole
  number is kept as one.
- **Entries** (actions, features, gear...) have a name, a roll, a cost, tags
  and a Markdown text, where an inline formula (`` `1d8+2` ``) is a dice button
  too. An entry that is only a name and a roll (a skill, a save) is drawn as
  one row, the roll at its end.
- **Layout**: "Side by side" puts the sheet's sections in columns on a wide
  sheet (**Full width** takes a section across the whole row); "Entries" lays
  a section's entries out in a grid. Narrow sheets (a phone, the encounter
  tracker) fall back to fewer columns on their own.
- **Tabs**: sections sharing a **Tab** (Spells, Gear) are shown one tab at a
  time, under a tab bar placed after the sections without one, so a long sheet
  stays one screen tall. A titled section folds with a click; **Starts
  folded** starts it folded.
- **Counters follow the sheet.** When a character's sheet is saved, each counter
  keeps its current value (within its new range), a new one starts where the
  sheet says, and one the sheet no longer has is dropped — so renaming a counter
  starts it again.
- A sheet with a mistake (two counters with the same name, a minimum above the
  maximum) can't be saved: the builder says what is wrong.
- A sheet is stored as JSON in its document (`sheet`). Sheets used to be
  YAML; any still stored that way are converted when the app starts.
- `GET /api/sheets` lists every character and adversary (signed in), and
  `GET /api/sheets/detail?type=&ref=` returns one, read.

**Encounters** — who is in a fight, live for everyone at the table. Add
adversaries and characters; each one gets counters (HP, Stress... whatever its
sheet defines) with ± buttons, free-text conditions, notes, defeated, and its
sheet's actions with dice buttons. There are no
rounds, turns or initiative, since how a fight is ordered is a rule of the
system being played: drag the combatants (or use the arrows) into whatever
order suits your table.
- Add **3 Bugboars** and each has its own copy of the sheet's counters, starting
  alike and then diverging. A **character** is added once and has no counters of
  its own: its counters are the character's, the same on its notes and in every
  encounter, and persist between sessions.
- Everyone signed in can change everything, and sees every change as it is
  made (a WebSocket announces them; there is no Save button). Lose the
  connection and it reloads from the server on reconnecting.
- **Add to encounter**, under a sheet shown in a note, puts it into one without
  leaving the note.

**Battlemaps** — a tactical map to play a fight out on, shared live like an
encounter. Pick a map image from the Observatory and lay a grid over it
(cell size and offset in pixels of the image, snapping on or off). Tokens are
placed in cells, so changing the grid never moves anyone; drag them, resize
them, give them an image or a colour. A **ruler** measures between cells: you
say what one cell is worth (5 ft, 1.5 m, 1 square…) and whether a diagonal
costs one cell or its length.
- Attach an **encounter** and *Place combatants* puts a token for each one. A
  token can show some of its combatant's counters as bars (an adversary's own,
  or a character's), and they follow the encounter as it changes.
- **Hidden** tokens are dimmed for everyone signed in and **never sent to the
  screen**: *Show on the screen* sends the server's view of the map, made
  without them (and without which sheet or combatant a token stands for). The
  screen follows every change — moves, new tokens, counters — a moment later.
- **Play the sheets from the map.** The *Sheet* tab shows whoever the selected
  token stands for (double-click a token, or pick anyone in the encounter, on
  the map or not): their whole sheet, with its counters live (an adversary's
  own, a character's saved ones), conditions, notes, *defeated*, and a link to
  edit the sheet. Its rolls are named after the combatant ("Bugboar 2 · Gore"),
  go to the screen like any roll, and show over the token for a few seconds,
  for everyone on the map and on the screen (unless the token is hidden).
- **Point at things.** The pointer tool (`P`; `V` selects, `R` measures): a
  tap pings a spot, a drag is a laser pointer with a fading trail.
  Double-clicking the bare map pings too. Everyone with the map open sees it,
  in the pointer's own player colour and with their name, and so does the
  screen when it shows this map. Nothing is kept: a ping is not part of the map.
- Everyone signed in can move any token and change any setting.

**The Observatory** — where everything but the notes lives: one tree of folders
holding every chart, vista, encounter, battlemap, character and adversary, and
the images they draw, so an adventure's map, its chart, its scenes and its fights
can share a folder. **New ▾** makes a document of any kind in the folder you are
in; opening one opens its editor, whose back arrow comes back to that folder.
Drag anything (folders too) into another folder. Next to **Folders**, a view per
kind shows every chart, vista, encounter… (or image) wherever it is, each with
its folder; the sidebar's Observatory tile has a shortcut to each of them.
- An image is found by the uid it got when uploaded, so renaming or moving it —
  or the folder it is in — never breaks the documents and notes that show it.
- **Import** brings images, documents (`tavern.chart.json`, `night.vista.json`…)
  and zips of them into the folder you are in; dragging files from the computer
  onto the Observatory does the same (onto a folder, into it). Nothing there is
  replaced: a document whose name is taken comes in as a copy beside it.
- **Export** downloads the folder you are in (everything, at the top) as a zip of
  its files and subfolders: import it into any folder, here or on another
  instance, to bring them all back.

**Game-master tools**
- **Charts** — maps with pins (icon, color, size, linked note), hand-drawn
  paths with direction arrows, and text annotations.
- **Vistas** — perspective scenes: a background plus assets that shrink as
  they move toward a vanishing point, with flip, rotation and color
  adjustments.
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

Documents, images, folders and tracks can all be created, renamed, moved and
deleted from the UI.

**Access control**
- Reading notes is public. The characters and adversaries a note shows are not:
  a reader who isn't signed in sees "Sign in to see this character" in their place.
- Everything else — charts, vistas, characters, adversaries, encounters,
  battlemaps, the Observatory's images,
  the music player, writing and screen control — requires Google login, limited
  to an allow-list of emails. Sessions are signed cookies, no user database.
- A paired screen (`/screen#key=…`, a TV or OBS source with no login) can read
  only what is on it right now: the chart or vista last sent and the images it
  draws, the image sent with "display media", or the images of the battlemap
  shown (without its hidden tokens) — nothing else.
- Set `ENABLE_AUTH=false` to run it open as a single local user.

## How data is stored

| Data                      | Where                                                       |
| ------------------------- | ----------------------------------------------------------- |
| Notes                     | `.md` files in the vault (a Git repository)                 |
| Audio (the player)        | `player/<album>/<track>` in the bucket                      |
| Documents                 | `observatory/<folders>/<slug>.<kind>.json` in the bucket    |
| Images                    | `observatory/<folders>/<uid>-<name>` in the bucket          |

where `<kind>` is `chart`, `vista`, `encounter`, `battlemap`, `character` or
`adversary`. The bucket is any S3-compatible store (MinIO, Ceph RGW, AWS S3, …)
with those two top-level prefixes and nothing else at the top. A document's id is
its folders and slug (`Hijos del Fango/Acto 2/emboscada`), which is how a note
links to it; an image is served at `/api/observatory/images/<uid>-<name>`.

The backend clones `REPO_URL` on startup, pulls every `GIT_SYNC_INTERVAL`
seconds, and commits and pushes every edit made to a note in the app. You can
keep editing the same vault in Obsidian — both sides stay in sync through Git.

Everything else is not in Git: the vault is a throwaway clone that a redeploy
replaces, and a map or a fight changes while people play. Those documents are
JSON objects in the bucket, one `PUT` per save, with no lock and no commit.
Charts, vistas and adversaries are edited whole and saved with a button;
encounters, battlemaps and characters are *live*: held in memory while someone
is using them and written a couple of seconds after the last change (and when the app shuts
down). Without an S3 endpoint the documents and images go to `DOCS_LOCAL_PATH`
instead (the same `observatory/` tree, as folders), for local development. Don't redeploy in the middle of a session: the new pod would
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

**Coming from a vault that wrote sheets in notes** (` ```sheet ` blocks, how
earlier versions kept them): on its first start the backend makes a document of
each valid block, once (the marker `observatory/.imported-from-notes` stops it
running again). A character goes to `<its sheet id>` at the top of the
Observatory, joining the counters it had saved; an adversary goes to `<its
note's folder>/<its sheet id>` (`-2`, `-3`… if two would collide), and the encounters
and maps that named it as `<note id>#<sheet id>` are pointed at it. Nothing in
the vault is changed. Once the deployed app has imported them (its log says
so), run `python backend/scripts/sheets_to_documents.py <vault>` on a checkout
of the vault: it replaces each block with the link to its document. Commit and
push the vault, and delete the script.

**Moving a bucket into the Observatory** (from the layout of 0.2.3 and before:
one prefix per kind, `charts/<folders>/<id>/chart.json`…, and the images in
`asset-library/`): `backend/scripts/migrate_to_observatory.py` does it once, for
any bucket, and can then be deleted. It reads the same `S3_*` settings as the app
and shows what it would do unless told otherwise:

```bash
cd backend
python scripts/migrate_to_observatory.py               # dry run: what goes where, and any conflict
python scripts/migrate_to_observatory.py --copy-only   # copy and check; the old keys stay
python scripts/migrate_to_observatory.py --apply       # copy, check, delete the old keys
```

Document ids don't change, so the notes' `chart:<id>` links keep working. Image
URLs do (`/api/asset-library/assets/asset-library/<folders>/<name>` becomes
`/api/observatory/images/<uid>-<name>`): the script rewrites them in every
document as it copies it, and `--vault <checkout of the vault>` rewrites them in
the notes (then commit and push the vault). An image uploaded before images got
a uid is given one made from its old key, the same every run.

Nothing is deleted before its copy is checked, so a run that stops halfway can be
run again. For a live deployment: run `--copy-only` while the old version is
still serving, deploy the new version, then run `--apply`: a document edited in
between is in both places, and the copy saved last is the one kept. Run it
against the same bucket the app uses, from a shell with its `S3_*` settings (for
Kubernetes, `kubectl exec` into the backend pod: the script is in the image).

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
| `DOCS_LOCAL_PATH`       | `./docs-data`            | Where charts, vistas, characters, adversaries, encounters and battlemaps are kept when there is no `S3_ENDPOINT_URL` |
| `ENABLE_AUTH`           | `true`                   | `false` disables login entirely                                   |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | —    | Google OAuth client (redirect URI: `<backend>/api/auth/callback`) |
| `ALLOWED_EMAILS`        | —                        | Comma-separated emails allowed to log in; each one's position sets their dice colour |
| `SESSION_SECRET_KEY`    | random per start         | Signs session cookies — set it in production                      |
| `SESSION_COOKIE_SECURE` | `false`                  | `true` when served over HTTPS                                     |
| `FRONTEND_URL`          | `http://localhost:5173`  | Where to redirect after login                                     |
| `CORS_ALLOWED_ORIGINS`  | `http://localhost:5173`  | Comma-separated allowed origins                                   |
| `LOG_LEVEL`             | `INFO`                   | Backend log level                                                 |
| `LOG_DIR`               | `/app/logs`              | Where `app.log` and `error.log` are written (rotated at 10 MB, 3 kept) |
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
│   ├── models/         Pydantic models (notes, sheets, charts, vistas, characters, adversaries, encounters, battlemaps)
│   ├── routes/         notes, sheets, observatory, charts, vistas, characters, adversaries, encounters, battlemaps, sync, player, screen, auth
│   ├── services/       Markdown + sheet parsing, Git commits, S3 storage, the Observatory's documents and images (observatory, doc_*, sync_hub, sheet_*)
│   ├── scripts/        One-time tools (migrate_to_observatory.py, sheets_to_documents.py)
│   └── tests/
├── frontend/           Vue 3 + Vite app, served by nginx in production
│   └── src/
│       ├── views/      Home, NoteView, ScreenView
│       ├── components/ Sidebar, the Observatory, document modal (charts, vistas, characters, adversaries, encounters, battlemaps), sheets, graph, player, dice
│       ├── composables/
│       ├── dice/       three.js + cannon-es dice simulation
│       └── api/
├── .argocd/            Kubernetes manifests
├── .github/workflows/  CI: tests on every pull request; version bump, image build and push
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
