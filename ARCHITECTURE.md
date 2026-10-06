# Realm Keeper Architecture

## Overview

Realm Keeper turns an Obsidian/Markdown vault into an interactive web platform
and adds the tools a game master reaches for at the table. FastAPI serves the
API and the live sockets; a Vue 3 app renders everything.

Two ideas shape most of the code:

- **No database, two durable stores.** Notes live in a Git repository (the
  vault). Everything else — charts, vistas, characters, adversaries, encounters,
  battlemaps, images, audio — lives in S3-compatible object storage.
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
   │  notes ── MarkdownService ── Git                   screen ── ConnectionManager │
   │  Observatory ── make_doc_router ── DocCollection      ▲ BattlemapScreen        │
   │  live documents ── DocHub.mutate ─────────────────────┘ (projection)           │
   └───────┬──────────────────────────────┬─────────────────────────────────────────┘
           │ git pull / commit / push     │ S3 (player/, observatory/)               
           ▼                              ▼
      vault repository               bucket (MinIO, Ceph RGW, AWS S3…)
```

## Where data lives

| Data                          | Store | Key / location                                   |
| ----------------------------- | ----- | ------------------------------------------------ |
| Notes                         | Git   | `.md` files in the vault                         |
| Documents (every kind)        | S3    | `observatory/<folders>/<slug>.<kind>.json`       |
| Images                        | S3    | `observatory/<folders>/<uid>-<name>`             |
| Empty folders                 | S3    | `observatory/<folders>/.keep`                    |
| Audio                         | S3    | `player/<album>/<track>`                         |

Two top-level prefixes, and nothing else at the top of the bucket. `observatory/`
is one tree of folders shared by every kind of document and the images they
draw (`services/observatory.py`), so a folder can hold an adventure's map, its
chart, its vistas and its encounters; a kind's files are told apart by their
`.<kind>.json` ending (`DocType.suffix`), and two of different kinds may share a
slug. `player/` belongs to `storage_service.py`. A track's key as the player and
the notes see it is `<album>/<track>`: the `player/` in front is only where it
is stored, so notes that name a song don't care where it lives. A sound effect
(`sfx:<album>/<track>` in a note) is just a track too: the browser plays it
on an `<audio>` of its own (`composables/useSoundEffects.js`), over the music
rather than instead of it, so any track can be either.

Nothing in a note or a document names an image's storage key either: they name
its URL, `/api/observatory/images/<uid>-<name>`, and the image is found by the
`uid` alone (eight hex digits, given at upload; a rename keeps it). So renaming
or moving an image, or a folder full of them, breaks nothing. Which key holds
which uid is an index in memory (`Observatory.image_key`), read from the store
when first needed and again when asked for a uid it doesn't know (at most every
two seconds). The image route serves images only: a document beside them is read
through its own kind's routes, a track through the player's.

Without an S3 endpoint the tree goes to `DOCS_LOCAL_PATH` instead, as folders
(local development and tests).

`backend/scripts/migrate_to_observatory.py` moves a bucket that has the previous
layout (one prefix per kind, `<kind>s/<folders>/<slug>/<kind>.json`, and the
images under `asset-library/`) to this one, rewriting image URLs in documents,
and with `--vault` in the notes; see the README. It is a one-time tool, not
something the app does or keeps compatible with: the app reads and writes only
this layout.

## Backend

### Notes

- **`MarkdownService`** reads, parses and caches the vault's notes (a 5-minute
  cache that a Git pull invalidates). `follow_moved_documents` rewrites the
  notes' links to documents that moved (`` `chart:old` `` → `` `chart:new` ``),
  in one commit.
- **`MarkdownParser`** extracts frontmatter and tags, converts wiki-links, and
  renders Markdown. Tags are not read inside fenced blocks (`services/fences.py`),
  so `color: #ff0000` in a code block or a mermaid `style` line doesn't become a tag
  and a `#private` inside a block doesn't hide the note.
- **Git sync** (`main.py`, `git_sync_utils`): clone on startup, pull every
  `GIT_SYNC_INTERVAL` seconds, and commit + push every note edited in the app.
  Everything that writes the vault or runs git (a save, links followed after a
  move, the periodic pull) holds one re-entrant lock (`MarkdownService.git_lock`),
  the file write included. A pull rebases our own unpushed commits (after a
  failed push) and aborts a rebase that conflicts, so the vault is never left
  mid-rebase; a git that times out is killed, its `index.lock` removed, and
  reported. This is the only code that talks to Git.
- **Saving a note** sends the `sha` of the content the editor loaded
  (`GET /api/note-raw` returns it): if the note has changed since (another
  GM, an Obsidian edit that a pull brought in), the save is a 409 and nothing
  is written; `""` means "create, it must not exist". Saving unchanged
  content is a no-op. The note routes (like the player's) are plain `def`s,
  run in FastAPI's threadpool: git and S3 never block the event loop that the
  live sockets share.

### Sheets

A sheet describes a character or an adversary (counters, stats, entries, in
sections, and free text). Each one is a document of its own (see *Documents*
below), whose `sheet` field is the sheet as JSON (`models/sheet.py`
`SheetBody`): a **`character`** is an individual, live (see *Characters*); an
**`adversary`** is a template, saved whole, never with state of its own, and
*copied* into an encounter once per instance. Neither is written in a note: a
note shows one with an inline link, `` `character:<id>` `` or
`` `adversary:<id>` ``. Its name, id and type are the document's (its name,
where it is stored, its kind).

`SheetBody` is the sheet as it is built: a header (`subtitle`, `image`,
`tags`), `columns`, `text`, and `sections`, each with its `counters` (a list,
each named: `{name, max, min, start, color, style}`), groups of `stats`
(`{title, columns, stats: [{label, value, roll}]}`) and `items`. It validates
itself: counter names unique in the sheet (at most 24), a minimum not above
its maximum, columns 1 to 12, bounded lengths, no unknown fields.
`sheet_parser.py` `parse_sheet_doc` reads a document into the `SheetSpec`
everything draws and plays from (`spec_from_body`: counters gathered by name
into `resources`, each section naming its own). A sheet that isn't valid, or
whose image isn't an Observatory one, is **refused when it is stored**
(`services/sheet_docs.py` `sheet_preparer`, the kinds' `DocType.prepare`), so
what a note shows always reads; the same hook stores the sheet whole (every
field, defaults filled) and copies its `image`, `subtitle` and `tags` onto the
document for its gallery card.

`routes/sheets.py` serves the catalog behind login, like the documents
themselves: `GET /api/sheets` lists every character and adversary, read
(`services/sheet_catalog.py`; a summary carries its `folder`), and
`GET /api/sheets/detail?type=&ref=` returns `{ref, type, sheet, warnings}`. A
character held by the hub is read from its memory (`DocHub.held`), so the catalog
is never behind what is being played.

The frontend draws documents the same way (`utils/sheet.js` `sheetFromDoc`);
both are checked against shared fixtures in
`backend/tests/fixtures/sheet-bodies/`, so a change in one needs the same change
in the other. A sheet is held to what an encounter can hold (at most 24
counters, a counter's `color` and `style` at most 40 and 20 characters, the
limits of `models/encounter.py`), so one that is stored can always be added to
a fight, and a counter starts within its range on both sides (`counterStart`).

**Editing.** `SheetEditor` is the sheet builder (`SheetBuilder`, forms) beside
a live preview. `utils/sheetModel.js` `modelFromBody` makes an editable copy of
a sheet, every field present to bind a form to; `bodyFromModel` turns it back
into the sheet that is saved, leaving out rows still without a name and
trimming what was typed. `sameSheet` compares two sheets by what they save
(the character editor's unsaved-changes check). `sheetProblems` says what the
server would refuse, for the author.

**The YAML sheets used to be.** Sheets were YAML, first in notes (` ```sheet `
blocks), then in documents (`source`). `parse_sheet_source` still reads that
format (its cases are `backend/tests/fixtures/sheets/`), and
`upgrade_legacy_source` turns a `source` into a `sheet` (`body_from_spec`; the
sheet's top-level `stats` become a first, untitled, `wide` section, which is
how they were drawn). At startup `services/sheet_import.py`
`convert_yaml_sheets` converts every stored character and adversary still in
YAML (nothing to do once they are all JSON; one that doesn't read is logged and
left as it was). `SheetDoc` converts on read too, so the hub, an import of an
old export or a document written by a pod still running the previous version
are read the same.

**Importing the sheets notes used to hold.** Earlier versions wrote sheets in
notes, as ` ```sheet ` blocks. On startup, after the legacy charts and vistas,
`services/sheet_import.py` `import_note_sheets` makes a document of each valid
block, once (marker `observatory/.imported-from-notes`), without touching the
vault: a character goes to `<sheet id>` at the top of the tree, merged with the
values it had saved there; an adversary to `<note's folder>/<sheet id>` (`-2`,
`-3`… on a collision), and the encounters and maps that named it
`<note id>#<sheet id>` are repointed. `backend/scripts/sheets_to_documents.py
<vault>` then replaces each block in a vault checkout with its link; it is run
once after the deploy and deleted.

### Documents: one layer for every kind

Charts, vistas, characters, adversaries, encounters and battlemaps are the same
thing with different models: a JSON document in the Observatory's folder tree.
They are written once.

| Piece                | File                         | What it is                                                                 |
| -------------------- | ---------------------------- | -------------------------------------------------------------------------- |
| `DocType`            | `services/doc_type.py`       | Declarative spec of a kind: prefix, models, locked fields, which fields may hold images, image routes, live or not, a `prepare` hook |
| `DocBackend`         | `services/doc_backend.py`    | Text (`get/put`) and files (`put_file/open`), `exists/delete/move`, and prefixes (`list_keys/delete_prefix/move_prefix`); S3 or a local folder |
| `DocCollection`      | `services/doc_collection.py` | Create (unique slug), save, rename, move, delete, add (an import) one kind's documents |
| `Observatory`        | `services/observatory.py`    | The shared tree: a folder's contents (every kind and the images), folders, images by uid, the zip backup |
| `make_doc_router`    | `routes/doc_router.py`       | Every HTTP route of a kind, generated from its `DocType`; an `on_moved` hook |
| `make_observatory_router` | `routes/observatory.py` | `/api/observatory`: listing, folders, images, `/export`, `/import` |
| registry             | `services/doc_registry.py`   | Declares `CHART`, `VISTA`, `CHARACTER`, `ADVERSARY`, `ENCOUNTER`, `BATTLEMAP`, the collections, the Observatory and the hub |

A document is one file, `<folders>/<slug>.<kind>.json`; its id is
`<folders>/<slug>`, and an empty folder is kept by a `.keep` marker. Where a
document is stored is authoritative over the `id` written in it. Folders belong
to no kind: moving or deleting one (`routes/observatory.py`) lets go of the live
documents inside first, as a single document's move does, then runs each kind's
`on_moved` for the ids that changed. A document can't be inside a folder named
like one of its kind's lists (a map in `…/tokens/…`, an encounter in
`…/combatants/…`): its routes would read the path as one of its entities
(`DocCollection.check_id`, also checked when a folder moves).

**Saving a saved document** (chart, vista, adversary) sends `base_updated_at`,
the `updated_at` of the copy the editor loaded: if the stored one has moved on
(another tab, another GM), the save is a 409 (`DocConflict`) and nothing is
written; the editor says so, and Save again overwrites on purpose.

**Export and import.** `GET /api/observatory/export?path=` is a zip of a folder
(the whole tree by default), named from that folder, after the live documents
are flushed. `POST /api/observatory/import` takes files and a folder: images,
documents (`<name>.<kind>.json`, validated as a save would be) and zips of them,
whose own subfolders go inside it. Nothing there is replaced: a document whose
slug is taken gets the next free one, and an image keeps its uid only where it
is free (so the documents that came with it still find it), otherwise it gets a
new one. What is left out comes back with why — anything one file does (a
damaged zip entry, a document over 1 MB, the store refusing it) leaves only that
file out. A zip over 20,000 files or 4 GiB is refused before anything is read
from it.

Two rules are enforced for every kind, in one place (`DocType`):

- **Images must come from the Observatory** (`image_fields`). A paired screen
  may read exactly those and nothing else, so no document can make the app
  fetch an arbitrary URL on a viewer's behalf.
- **Fields set through their own route are locked** on a save (`locked_fields`,
  `asset_routes`): a chart's map image is changed by `POST /<id>/image`, which
  checks it, not by a whole-document `PUT`.

Two hooks let a kind do more without its own collection or routes:

- **`DocType.prepare(doc, previous)`** is called on every document about to be
  stored — by `DocCollection` (`create`, `save`, `set_field`) and by a command in
  `DocHub.mutate` — with what was stored before (`None` for a new one). It may
  fill in fields derived from others, and raises `ValueError` to refuse the
  document. Sheets use it (see *Sheets* and *Characters*).
- **`make_doc_router(..., on_moved=)`** is awaited with `{old_id: new_id}` and the
  user after a move, a folder rename or a folder move, once the documents are in
  their new place. `routes/doc_follow.py` `ON_MOVED` holds it for the kinds a
  note can show (charts, vistas, characters, adversaries), built with
  `following(kind, ...)`, and the Observatory's folder routes use the same: it rewrites
  the notes' `` `kind:<id>` `` links in one commit, then runs whatever else it is
  given — for sheets, `services/sheet_refs.py` `follow_moved_sheets`, which
  repoints encounter combatants (of that type) and battlemap tokens. A failure
  there is logged; the move has already happened.

**Saved documents** (charts, vistas, adversaries) are edited whole in the browser
and written with `PUT`. **Live documents** (encounters, battlemaps, characters)
are described next.

**Importing what Git used to hold.** Earlier versions kept charts and vistas in
the vault (`_charts/`, `_vistas/`). On startup `DocCollection.import_legacy`
copies them into the bucket, once per kind: nothing in the vault is touched, a
document already in the bucket is never replaced, and a marker
(`observatory/.<kind>s-imported-from-vault`) stops a document deleted afterwards from coming back
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
  counter's `min`/`max`, so two people hitting the same counter both count —
  and `…/<entity>/list {field, add, remove}`, entries in or out of an entity's
  list (a combatant's conditions, a token's bars) for the same reason: two
  people adding a condition at once both add one, where writing the whole list
  would keep only the last. Clients never write a whole live document.
- **The socket only talks one way.** `/ws/sync` (login required) carries events
  server → client; nobody sends anything on it. An event is
  `{type: "doc", doc: "encounter:fight", rev, set, upsert, remove, order}`: whole
  fields, entities (by `id`) added or replaced, removed, and re-ordered. The
  same diff code is mirrored by `utils/applyEvent.js`, and both are tested
  against shared cases. It is sent to every client at once, each with a 2 s
  limit (`services/socket_group.py`, shared with the screens' `/ws/screen`): one
  that can't be written to is dropped and closed, so a client that was only slow
  reconnects and catches up, and nobody waits for a phone gone to sleep.
- **Persistence is behind the same door.** After `FLUSH_DELAY` (2 s) of quiet,
  and never later than `FLUSH_MAX_WAIT` (15 s) under constant edits, a changed
  document is written to its backend; it is written again on shutdown. A failed
  write is retried, not dropped. A document nobody touches for 10 minutes
  leaves memory.
- **`rev` guards the write.** If the stored copy is *ahead* of what this process
  last saw (another process wrote it), the stored one wins: the room reloads it
  and tells clients to reload (`{doc, reset: true}`), rather than guess how two
  histories fit.
- Moving or deleting documents (one, or a folder of them) happens inside
  `async with hub.released(kind, ids)`: each room is saved and closed under its
  lock, and clients are told (`{type: "gone"}`); until the block is over nobody
  can load those ids again (a command or a read waits, then finds the document
  where it is by then), and whatever loaded one meanwhile is dropped unsaved.
  If the last save fails, the move or delete doesn't happen. Without this a
  command landing during the last save brought a deleted document back.

On the client, `useSyncedDoc` loads a snapshot (with its `rev`), applies events
whose `rev` is exactly one more than its own, ignores ones it already has,
holds one that comes early for 300 ms waiting for the ones before it (a command's
reply can overtake the socket), refetches on a gap that doesn't fill or a
reconnect (once more if asked while a fetch is on its way), and shares one copy
per document between all the components that ask for it, kept 3 s after the last
lets go (a note's preview remounts its embeds on every keystroke). A command's
HTTP reply is the same event, applied at once.

### Characters

A character is a live document, `observatory/<folders>/<slug>.character.json`:
its name, description, sheet (`sheet`) and the current value of each of its
counters (`resources`), shared by every note that shows it and every encounter
and map it appears in. Its gallery card's `image`, `subtitle` and `tags` are
derived from the sheet when it is stored, and it has a `rev` like every live
document (`schema_version` 3).

`resources` follows the sheet, on the server: whenever a character is stored,
`prepare` (`sheet_docs.fit_counters`) fits it to the counters the sheet declares.
A counter already there keeps its current value, clamped to its new range; a new
one starts where the sheet says; one the sheet no longer has is dropped, so
renaming a counter starts it again. The client never reconciles anything.

It is made from the Observatory like any kind (**New ▾ → Character**), lives
in folders, and is edited in `CharacterEditor`: the sheet (`SheetEditor`) with its own
Save button (`PATCH {sheet}`, since the document is live), while
`POST /api/characters/<id>/adjust` changes one of its counters, from a note, an
encounter or a map. On the client, `useSyncedDocs` follows any number of
documents of a kind at once (an encounter's characters), and `useCharacters(ids)`
is built on it.

### Encounters

A group of combatants with counters, free-text conditions, notes and a defeated
flag. The order of the combatants is the table's own (drag them, or use the
arrows): there are no rounds, turns or initiative. A combatant keeps the `type`
and the document id (`sheet`) of the sheet it was made from. An `adversary`
combatant carries its **own copy** of the sheet's counters (three Bugboars diverge from
the same start); a `character` combatant has none, since its counters are the
character's own, and a character can be in an encounter only once.

### Battlemaps and the screens

A battlemap is a background image, a grid (square or none; snap, offset, what a
cell is worth, how the ruler measures) and tokens. Positions and sizes are in
**cells**, so changing the grid size moves nobody. A token may stand for a
combatant of the map's encounter (and name its sheet, `sheet`) and show some
of its counters.

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
├── components/   DocumentModal (+ the thin *Modal wrappers), canvases
│                 (ChartCanvas, VistaCanvas, BattlemapCanvas), SheetView, SheetEmbed,
│                 SheetEditor, SheetBuilder, SheetRefPicker, EncounterTracker, FolderGallery,
│                 sidebar, dice, player
├── composables/  useDocCollection, useDocModal, useSyncedDoc, syncSocket,
│                 useCharacters, useLiveScreen, useMapViewport, useNotes …
├── utils/        docTypes, sheet, sheetModel, applyEvent, encounter, battlemapGeometry …
├── api/          docs.js (createDocApi), sheets, assetLibrary, player …
├── dice/         three.js + cannon-es dice simulation
└── styles/       tokens.css, base.css (the `rk-` primitives)
```

- **`utils/docTypes.js`** describes every kind once: its wording, icons, which
  field is its picture, which fields a save sends, whether it can go on the
  screen or be embedded in a note (`embeddable`), and whether it is a sheet
  (`sheet`). `inlineRefs.js` (the `chart:<id>`, `character:<id>`… refs in notes),
  `DocumentEmbed`, `SheetEmbed`, `DocumentModal` and the Observatory all read from it.
- **`api/docs.js`** `createDocApi(prefix)` is the client of every kind (fetch,
  save, create, rename, move, image routes, and the live `commands`);
  **`api/observatory.js`** is the Observatory's (listing, folders, images, backup).
- **`components/ObservatoryModal.vue`** is where documents and images are found:
  a folder of the shared tree (`FolderGallery`), every kind side by side, a
  filter by kind, **New ▾** for any kind, Import (also by dropping files from the
  computer onto it, through `FolderGallery`'s `drop-files`) and Export.
  Opening a document opens its kind's editor (`useDocModal(kind).open(id)`); an
  image opens in a viewer. As a picker (`picker-mode`, from an editor choosing a
  map or an icon) it shows only images, starting in the document's own folder.
  `useObservatoryModal().open(path)` opens the main one at a folder.
- **`components/DocumentModal.vue`** is the one editor shell for every kind,
  opened on a document, with an `editor` slot; its back arrow goes to the
  Observatory, in the document's folder.
  A *live* kind's editor owns its document. A *saved* kind (`kind.saved`) gets
  the document loaded for it, edits it in place and calls `markDirty()`; the
  shell adds Save, the unsaved-changes guard, Send to screen / Go live
  (`useLiveScreen`) and the copyable `chart:<id>` reference. `ChartsModal`,
  `VistasModal`, `AdversariesModal`, `CharactersModal`, `EncountersModal` and
  `BattlemapsModal` are each only their editor.
- **A note on the page.** `NoteView` is only the page: `useNoteLoader` fetches
  the note (a request token drops an answer for a note the view already left),
  `utils/renderNote.js` turns its markdown into safe HTML plus its headings
  (callouts, heading ids, mermaid blocks, scrollable tables; the table of
  contents in `RightSidebar` takes those headings), and `MarkdownBody` makes
  that HTML live: note links routed in the app, embeds mounted
  (`useDocEmbeds`), mermaid drawn (`useMermaid`, imported only for a note that
  has a diagram), and for a signed-in user dice, roll tables, songs, sound
  effects (`useInlineActions`) and images' Screen button, through one click
  listener. It sets all of that up again whenever the HTML or the user
  changes. `NoteEditor` (`useNoteDraft`) is the editor, with the same
  `MarkdownBody` as its preview; a save sends the sha it loaded (`base_sha`),
  and a 409 keeps the draft and offers "Reload their version" or "Overwrite".
  A save calls `notifyNotesChanged()` (`useNotes.js`), on which the sidebar,
  the tags, the graph (`useGraphData`) and the folder notes refresh. Every note
  URL is built by `utils/paths.js` (`noteRoute`, `noteApi`, `noteIdFromHref`).
- **Charts, vistas and battlemaps share their map mechanics.**
  `useMapViewport` (zoom, pan, screen ↔ map coordinates) was extracted from
  `ChartCanvas` and is used by `BattlemapCanvas` too; `battlemapGeometry.js` is
  pure functions (cells ↔ pixels, snapping, measuring) with its own tests.
  Every canvas drags with `usePointerDrag` (primary button and one pointer
  only, captured, a threshold in screen pixels, `pointercancel` puts things
  back, the click after a drag swallowed), sizes its image with `useImageSize`
  (and says so when it can't be loaded, `CanvasEmptyState`), and picks images
  with `useLibraryPicker`. The live editors (tracker, battlemap) share
  `useLiveDocument`, `LiveBadge` and `LiveDocumentState`.
- **Sheets in notes.** A `` `character:<id>` `` or `` `adversary:<id>` `` link
  becomes a placeholder like a chart's, and `MarkdownBody` (`useDocEmbeds`) mounts
  a `SheetEmbed` on it (a `DocumentEmbed` for a chart or vista) — also in the
  editor's preview. `SheetEmbed` loads the document and renders `SheetView`; a
  character's counters there are the same live ones the encounters show, and
  can be played from the note. Its footer has **Edit** (the kind's modal, on it)
  and **Add to encounter**. A sheet named like the note's title or a heading
  hides its name. Signed out, it shows "Sign in to see this character".
- **Sheet editing.** `SheetEditor` is the sheet builder beside a live preview
  ("Start from a template" when empty: a menu of game systems, Generic,
  D&D 5e, Daggerheart, Pathfinder 2e and Call of Cthulhu 7e, each with a
  character and an adversary sheet in `utils/sheetTemplates.js`); `CharacterEditor` and
  `AdversariesModal` use it. In the note editor,
  `SheetRefPicker` (the **Sheet** button) searches the catalog and inserts a
  link.

## Adding a new kind of document

1. A Pydantic model (a `…Metadata` with what a gallery needs, and the whole
   document) in `backend/models/`.
2. A `DocType` in `services/doc_registry.py`, and its collection (and, if it is
   live, an entry in the hub). Say which fields hold images and which are locked.
3. A route module: `router = make_doc_router(TYPE, collection, hub)`, included
   in `main.py` (it is `no-store` like every `/api/` route not listed public in
   `config/cache.py`). If a note can show it, add `following("<kind>")` to
   `ON_MOVED` in `routes/doc_follow.py` and pass `on_moved=ON_MOVED["<kind>"]` so
   its links follow a move; if other documents name it by id, give `following`
   the hook that repoints them (as `follow_moved_encounters` does for maps).
4. An entry in `utils/docTypes.js` (its client in `api/docs.js` is made from
   its `resource`), and a thin `*Modal.vue` around `DocumentModal` with the
   editor in its slot, mounted in `NotesSidebar.vue` beside the others and
   added to its `OBSERVATORY_SHORTCUTS`. If it is `embeddable` and not a sheet,
   an entry in `DocumentEmbed.vue`'s `TYPES`; if it can go on the screen
   (`screen`), its message in `utils/screenScene.js` and `ScreenView.vue`.
5. Its collection in the `Observatory`'s map (`doc_registry.py`) and its prefix
   in `scripts/migrate_to_observatory.py`'s `DOC_PREFIXES` while that script lives.

Nothing else — its place in the Observatory, folders, rename, move, delete,
backup, image checks and, for a live kind, sync, persistence and the screens'
hook — comes with it.

## Security

- **Login for everything but notes.** Reading notes is public; charts, vistas,
  characters, adversaries (and the sheet catalog), encounters, battlemaps, the
  Observatory, the player and every write need a signed-in user from the
  allow-list. A note that shows a sheet shows a signed-out reader only a
  "Sign in" placeholder. A paired screen
  reads only what is on it (see above).
- **State-changing requests and WebSocket handshakes are origin-checked**
  (`config/csrf.py`), including `PATCH`, which the live commands use.
- **Documents can't name arbitrary URLs for images** (Observatory images only), and
  a hidden token never reaches a screen: the projection is built before sending,
  and one made before a newer one is never sent after it.
- **Nothing private is cached by default.** Every `/api/` response is `no-store`
  (`config/cache.py`) except the public note reads (`public, no-cache`: kept,
  but revalidated every time) and the images (`private`, immutable by uid).
- **A dice roll sent to the screens is validated** (real dice and faces, at most
  50 dice): a screen replays every die it is given.
- **No roles yet.** Every signed-in user may do everything; `DocHub.authorize` is
  the one place a role check will go.
- Hardened asset endpoints (path traversal, `.resolve()`-bounded paths), `Opaque`
  Kubernetes secrets, and non-root containers with `allowPrivilegeEscalation:
  false`.

## Deployment constraints

- **One replica, one at a time.** Git writes are serialized in-process, and
  live documents and what the screens show are held in that process's memory.
  Several replicas would each hold a different copy of a room, so the backend
  deploys with `strategy: Recreate`: the old pod stops first (Uvicorn gives open
  connections 10 s, then the lifespan saves every live document), and only then
  does the new one start and load them. The price is the new pod's clone time
  without a backend.
- **Prefer not to deploy in the middle of a session**: the screens and every
  client reconnect, and a command sent in the gap fails.
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
- `npm run build` is the compile check (there is no lint step: `eslint.config.js`
  is there, its packages aren't).
- `.github/workflows/tests.yml` runs all three on every pull request and push to
  `main`.
