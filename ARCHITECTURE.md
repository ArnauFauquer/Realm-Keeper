# Realm Keeper Architecture

## Overview

Realm Keeper turns an Obsidian/Markdown vault into an interactive web platform
and adds the tools a game master reaches for at the table. FastAPI serves the
API and the live sockets; a Vue 3 app renders everything.

Two ideas shape most of the code:

- **No database, two durable stores.** Notes live in a Git repository (the
  vault). Everything else — charts, vistas, encounters, battlemaps, the saved
  values of characters, images, audio — lives in S3-compatible object storage.
  A pod's disk is throwaway (`/vault` is an `emptyDir` clone), so nothing that
  matters is kept only there.
- **Nothing is specific to a game system.** Counters have names the sheet's
  author chose, a fight has no rounds, turns or initiative (how a fight is
  ordered is a rule of the system being played), and a map's cell is worth
  whatever the table says. Features that would need to know a rule belong in a
  note, not in the code.

```
                       ┌──────────────────────── browser ────────────────────────┐
                       │  Vue 3 app            /screen (TV, OBS: no login)        │
                       └───┬─────────────┬───────────────────┬────────────────────┘
                  HTTP /api│     /ws/sync│ (login)           │/ws/screen (login or paired screen)
                           ▼             ▼                   ▼
   ┌────────────────────────────────────────────────────────────────────────────────┐
   │ FastAPI (one process)                                                          │
   │  notes ── MarkdownService ── sheets catalog        screen ── ConnectionManager │
   │  documents ── make_doc_router ── DocCollection        ▲ BattlemapScreen        │
   │  live documents ── DocHub.mutate ─────────────────────┘ (projection)           │
   └───────┬──────────────────────────────┬─────────────────────────────────────────┘
           │ git pull / commit / push     │ S3 (player/, asset-library/, charts/ ...)
           ▼                              ▼
      vault repository               bucket (MinIO, Ceph RGW, AWS S3…)
```

## Where data lives

| Data                          | Store | Key / location                                   |
| ----------------------------- | ----- | ------------------------------------------------ |
| Notes (and the sheets in them)| Git   | `.md` files in the vault                         |
| Charts                        | S3    | `charts/<folders>/<id>/chart.json`               |
| Vistas                        | S3    | `vistas/<folders>/<id>/vista.json`               |
| Encounters                    | S3    | `encounters/<folders>/<id>/encounter.json`       |
| Battlemaps                    | S3    | `battlemaps/<folders>/<id>/battlemap.json`       |
| Characters' saved values      | S3    | `characters/all/characters.json` (one document)  |
| Audio                         | S3    | `player/<album>/<track>`                         |
| Images                        | S3    | `asset-library/<folders>/<uuid>-<file>`          |

One top-level prefix per kind of thing, and nothing else at the top of the
bucket: a kind's prefix is its `DocType.prefix` (also its URL under `/api/`),
`player/` and `asset-library/` belong to `storage_service.py`. A track's key as the
player and the notes see it is `<album>/<track>`: the `player/` in front is only
where it is stored, so notes that name a song don't care where it lives. Nothing
in a note or document names an *asset's* storage key, though: they name its URL,
`/api/asset-library/assets/asset-library/...`, which is why that prefix keeps its
name. A track key can only ever reach `player/` and an asset key only
`asset-library/`; documents are reachable only through their own routes.

Without an S3 endpoint the documents go to `DOCS_LOCAL_PATH` instead, with the
same prefixes as folders (local development and tests).

`backend/scripts/migrate_storage_layout.py` moves a bucket that has the older
layout (albums at the top level, documents under `docs/`) to this one; see the
README. It is a one-time tool, not something the app does or keeps compatible
with: the app reads and writes only this layout.

## Backend

### Notes

- **`MarkdownService`** reads, parses and caches the vault's notes (a 5-minute
  cache that a Git pull invalidates), and builds the sheet catalog in the same
  pass over the notes.
- **`MarkdownParser`** extracts frontmatter and tags, converts wiki-links, and
  renders Markdown. Tags are not read inside fenced blocks (`services/fences.py`),
  so `color: #ff0000` in a sheet or a mermaid `style` line doesn't become a tag
  and a `#private` inside a block doesn't hide the note.
- **Git sync** (`main.py`, `git_sync_utils`): clone on startup, pull every
  `GIT_SYNC_INTERVAL` seconds, and commit + push every note edited in the app
  (under one lock). This is the only code that talks to Git.

### Sheets

A ` ```sheet ` block in a note is YAML describing a character or an adversary
(counters, stats, sections, free text). `sheet_parser.py` normalizes it into a
`SheetSpec`; `routes/sheets.py` serves the catalog (`GET /api/sheets`,
`/api/sheets/detail?ref=`), as public as the notes themselves.

- A **`character`** is an individual: it has a global `id`, and its current
  counters are saved (see *Characters* below). Renaming or moving its note
  loses nothing.
- An **`adversary`** is a template: it is referenced as `<note id>#<sheet id>`,
  never has saved state, and is *copied* into an encounter, once per instance.

The frontend renders the same blocks from the raw YAML (`utils/sheet.js`); the
two normalizations are checked against shared fixtures in
`backend/tests/fixtures/sheets/`, so a change in one needs the same change in
the other.

### Documents: one layer for every kind

Charts, vistas, encounters and battlemaps are the same thing with different
models: a JSON document in a folder tree. They are written once.

| Piece                | File                         | What it is                                                                 |
| -------------------- | ---------------------------- | -------------------------------------------------------------------------- |
| `DocType`            | `services/doc_type.py`       | Declarative spec of a kind: prefix, models, locked fields, which fields may hold images, image routes, live or not |
| `DocBackend`         | `services/doc_backend.py`    | `get/put/exists/list_keys/delete_prefix/move_prefix`; S3 or a local folder |
| `DocCollection`      | `services/doc_collection.py` | Folders, create (unique slug), save, rename, move, delete, over a backend  |
| `make_doc_router`    | `routes/doc_router.py`       | Every HTTP route of a kind, generated from its `DocType`                   |
| registry             | `services/doc_registry.py`   | Declares `CHART`, `VISTA`, `ENCOUNTER`, `BATTLEMAP`, `CHARACTERS`, the collections and the hub |

A document is the folder named by its slug plus one JSON file; an id is
`<folders>/<slug>`, and an empty folder is kept by a `.keep` marker. Where a
document is stored is authoritative over the `id` written in it.

Two rules are enforced for every kind, in one place (`DocType`):

- **Images must come from the asset library** (`image_fields`). A paired screen
  may read exactly those and nothing else, so no document can make the app
  fetch an arbitrary URL on a viewer's behalf.
- **Fields set through their own route are locked** on a save (`locked_fields`,
  `asset_routes`): a chart's map image is changed by `POST /<id>/image`, which
  checks it, not by a whole-document `PUT`.

**Saved documents** (charts, vistas) are edited whole in the browser and
written with `PUT`. **Live documents** (encounters, battlemaps, characters) are
described next.

**Importing what Git used to hold.** Earlier versions kept charts and vistas in
the vault (`_charts/`, `_vistas/`). On startup `DocCollection.import_legacy`
copies them into the bucket, once per kind: nothing in the vault is touched, a
document already in the bucket is never replaced, and a marker
(`<kind>/.imported-from-vault`) stops a document deleted afterwards from coming back
at the next start. Without the marker (a failed first try) it simply runs again.

### Live documents

Several people edit an encounter or a map at once — players move their own
tokens and change their own counters from their devices — and everyone watches
it change. `services/sync_hub.py` (`DocHub`) is built for that.

```
 client ── HTTP command ──► mutate(kind, id, fn) ──► validate ──► rev+1 ──► event ──► every /ws/sync client
 (typed: add, patch,           │ one lock per document            │
  remove, order, adjust)       │                                  └──► debounced write to the DocBackend
                               └──► listeners (the screens' view of a map)
```

- A live document is held in memory while anyone uses it. **Every change passes
  through `mutate`**: it applies an edit to a copy, validates the result with
  the model, rejects it (changing nothing) if it is invalid, bumps `rev`,
  broadcasts the event, schedules the write, and notifies listeners. It is the
  single place for an `authorize` check (today everyone signed in may do
  everything) and for future automations.
- **Commands are typed REST calls**, not a generic patch protocol:
  `POST/PATCH/DELETE /<id>/<collection>[/<entity>]`, `…/order`, and
  `…/<entity>/adjust {resource, by}` — a *relative* change clamped to the
  counter's `min`/`max`, so two people hitting the same counter both count.
  Clients never write a whole live document.
- **The socket only talks one way.** `/ws/sync` (login required) carries events
  server → client; nobody sends anything on it. An event is
  `{type: "doc", doc: "encounter:fight", rev, set, upsert, remove, order}`: whole
  fields, entities (by `id`) added or replaced, removed, and re-ordered. The
  same diff code is mirrored by `utils/applyEvent.js`, and both are tested
  against shared cases.
- **Persistence is behind the same door.** After `FLUSH_DELAY` (2 s) of quiet,
  and never later than `FLUSH_MAX_WAIT` (15 s) under constant edits, a changed
  document is written to its backend; it is written again on shutdown. A failed
  write is retried, not dropped. A document nobody touches for 10 minutes
  leaves memory.
- **`rev` guards the write.** If the stored copy is *ahead* of what this process
  last saw (another process wrote it), the stored one wins: the room reloads it
  and tells clients to reload (`{doc, reset: true}`), rather than guess how two
  histories fit.
- Moving, renaming or deleting a document first flushes and forgets its room and
  tells clients (`{type: "gone"}`).

On the client, `useSyncedDoc` loads a snapshot (with its `rev`), applies events
whose `rev` is exactly one more than its own, ignores ones it already has,
refetches on a gap or a reconnect, and shares one copy per document between all
the components that ask for it. A command's HTTP reply is the same event, applied
at once.

### Characters

The saved state of every `character` sheet is one live document
(`characters/all`), keyed by sheet `id`: its current counters, shared by its
note, every encounter and every map it appears in. A counter's *definition*
(max, min, colour) is copied from the sheet when the state is created and
brought up to date when the sheet changes (`useCharacters().reconcile`); the
current value is kept, clamped to the new range.

### Encounters

A group of combatants with counters, free-text conditions, notes and a defeated
flag. The order of the combatants is the table's own (drag them, or use the
arrows): there are no rounds, turns or initiative. An `adversary` combatant
carries its **own copy** of the sheet's counters (three Bugboars diverge from
the same start); a `character` combatant has none, since its counters are the
character's saved ones, and a character can be in an encounter only once.

### Battlemaps and the screens

A battlemap is a background image, a grid (square or none; snap, offset, what a
cell is worth, how the ruler measures) and tokens. Positions and sizes are in
**cells**, so changing the grid size moves nobody. A token may stand for a
combatant of the map's encounter and show some of its counters.

`/screen` — a TV, a projector, an OBS source — has no login, so what reaches it
is **built on the server**, never filtered by the screen:
`battlemap_projection.project_for_screen` drops `hidden` tokens, the sheet or
combatant a token stands for, and any counter it doesn't show.
`BattlemapScreen` keeps that projection current: it listens to the hub and
pushes a fresh one on every change to the map, its encounter or the characters,
coalesced to at most one per 80 ms so dragging a token doesn't flood the screens.

### Screens and who may read what

`/ws/screen` broadcasts what the GM is showing (`display_chart`, `display_vista`,
`display_media`, `display_battlemap`, dice rolls, the constellation, live drafts
of unsaved edits). A screen pairs with a screen key (`/screen#key=…`, swapped for
an `httponly` cookie) and that key only unlocks **what is on screen right now**
(`routes/screen_access.py`): the chart or vista last sent, the images it draws,
the image sent with "display media", or the images of a battlemap's current
projection. Everything else stays behind login, and a screen loses access the
moment something else is shown. Because a screen asks for a scene's images one
by one, the saved chart/vista behind that list is looked up once per thing shown
(re-read after a few seconds, or when it is sent again).

## Frontend

```
src/
├── views/        Home, NoteView, ScreenView
├── components/   DocumentModal (+ the four thin *Modal wrappers), canvases
│                 (ChartCanvas, VistaCanvas, BattlemapCanvas), SheetView/SheetBlock,
│                 EncounterTracker, FolderGallery, sidebar, dice, player
├── composables/  useDocCollection, useDocModal, useSyncedDoc, syncSocket,
│                 useCharacters, useLiveScreen, useMapViewport, useNotes …
├── utils/        docTypes, sheet, applyEvent, encounter, battlemapGeometry …
├── api/          docs.js (createDocApi), sheets, assetLibrary, player …
├── dice/         three.js + cannon-es dice simulation
└── styles/       tokens.css, base.css (the `rk-` primitives)
```

- **`utils/docTypes.js`** describes every kind once: its wording, icons, which
  field is its picture, which fields a save sends, whether it can go on the
  screen or be embedded in a note. `inlineRefs.js` (the `chart:<id>` refs in
  notes), `DocumentEmbed`, `DocumentModal` and the gallery all read from it.
- **`api/docs.js`** `createDocApi(prefix)` is the client of every kind (tree,
  fetch, save, create, rename, move, folders, image routes, and the live
  `commands`).
- **`components/DocumentModal.vue`** is the one shell for every kind: a folder
  gallery (`FolderGallery`, shared with the asset library) and an `editor` slot.
  A *live* kind's editor owns its document. A *saved* kind (`kind.saved`) gets
  the document loaded for it, edits it in place and calls `markDirty()`; the
  shell adds Save, the unsaved-changes guard, Send to screen / Go live
  (`useLiveScreen`) and the copyable `chart:<id>` reference. `ChartsModal`,
  `VistasModal`, `EncountersModal` and `BattlemapsModal` are each only their
  editor.
- **Charts, vistas and battlemaps share their map mechanics.**
  `useMapViewport` (zoom, pan, screen ↔ map coordinates) was extracted from
  `ChartCanvas` and is used by `BattlemapCanvas` too; `battlemapGeometry.js` is
  pure functions (cells ↔ pixels, snapping, measuring) with its own tests.
- **Sheets in notes.** `NoteView`'s Markdown rule for ` ```sheet ` emits a
  one-line placeholder (the YAML is carried encoded in an attribute, since a note
  inside a callout is rendered twice), and `mountDocEmbeds` mounts a `SheetBlock`
  on it — also in the editor's preview. A `character`'s counters there are the
  same live ones the encounters show.

## Adding a new kind of document

1. A Pydantic model (a `…Metadata` with what a gallery needs, and the whole
   document) in `backend/models/`.
2. A `DocType` in `services/doc_registry.py`, and its collection (and, if it is
   live, an entry in the hub). Say which fields hold images and which are locked.
3. A route module: `router = make_doc_router(TYPE, collection, hub)`, included
   in `main.py`; add its prefix to `config/cache.py` if a stale copy would hurt.
4. An entry in `utils/docTypes.js`, a client in `api/docs.js`, and a thin
   `*Modal.vue` around `DocumentModal` with the editor in its slot.

Nothing else — listing, folders, rename, move, delete, image checks and, for a
live kind, sync, persistence and the screens' hook — comes with it.

## Security

- **Login for everything but notes.** Reading notes (and the sheets in them) is
  public; charts, vistas, encounters, battlemaps, the asset library, the player
  and every write need a signed-in user from the allow-list. A paired screen
  reads only what is on it (see above).
- **State-changing requests and WebSocket handshakes are origin-checked**
  (`config/csrf.py`), including `PATCH`, which the live commands use.
- **Documents can't name arbitrary URLs for images** (library images only), and
  a hidden token never reaches a screen: the projection is built before sending.
- **No roles yet.** Every signed-in user may do everything; `DocHub.authorize` is
  the one place a role check will go.
- Hardened asset endpoints (path traversal, `.resolve()`-bounded paths), `Opaque`
  Kubernetes secrets, and non-root containers with `allowPrivilegeEscalation:
  false`.

## Deployment constraints

- **One replica.** The vault is a `ReadWriteOnce` volume, Git writes are
  serialized in-process, and live documents are held in that process's memory.
  Several replicas would each hold a different copy of a room.
- **Don't deploy in the middle of a session.** During a rolling update the new
  pod loads the last *saved* copy of a document, up to a couple of seconds behind
  the old one; the `rev` guard keeps the newest stored copy, and the old pod
  flushes on shutdown, but a change made in that overlap can be lost. For the
  same reason a chart edited while an upgrade from the Git-based storage rolls
  out would be lost.
- **Object storage is the history.** Charts and vistas used to have Git's
  history; now they have what the bucket gives. Turn on bucket versioning if your
  S3 supports it.

## Testing

- `cd backend && python -m pytest` — documents (both backends, parametrized),
  commands and the hub (ordering, validation, flush, the `rev` guard), routes,
  projection (a hidden token never leaves), screen access, the legacy import,
  sheets, and the security regressions.
- `cd frontend && npx vitest run` — the event layer, `useSyncedDoc`, the document
  modal, the tracker, the canvases' geometry, sheets, and the parity fixtures
  shared with the backend.
- `npm run build` is the compile check (there is no lint step).
