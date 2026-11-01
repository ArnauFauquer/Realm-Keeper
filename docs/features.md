# Features

Everything Realm Keeper does, in detail. For a first look, see the
[README](../README.md).

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
- In-browser note editing, written back to the vault (and committed and pushed,
  when the vault is a Git repository).
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
them, give them an image or a colour, and frame the image (drag it inside the
token, zoom, turn). A **ruler** (`R`) measures between cells: you say what one
cell is worth (5 ft, 1.5 m, 1 square…) and whether a diagonal costs one cell
or its length. Everyone on the map, and the screen, sees who is measuring
what.
- **Moving a token** draws the ruler from where it stands: it stays put while
  its ghost follows the pointer with the distance, and moves when you let go.
  **Space** (or a second finger) adds a turn to the path, Backspace takes it
  back; the distance counts every leg.
- **Range bands** for tables that play by ranges rather than squares: name
  your bands and how far each reaches (*Map → Distance → Range bands*). The
  ruler, a moving token and areas then say which band a distance falls in,
  with each band's ring around where it starts. Turn snapping off for free
  movement, and the grid off altogether if the map has none.
- **Areas** (`A`): circles, cones, lines and squares dragged out from where
  they start (spells, zones, hazards). They stay on the map until removed.
  Click one (its outline or origin) to select it: drag it from inside to move
  it, drag its white handle to resize it (and turn a cone or line); name,
  colour or hide it from the screen in *Tokens → Areas*.
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
  *Add to the fight* brings adversaries and characters from their sheets into
  the encounter and puts their tokens on the map; a map without an encounter
  gets one of its own with *New encounter for this map*.
- **Point at things.** The pointer tool (`P`; `V` selects): a
  tap pings a spot, a drag is a laser pointer with a fading trail.
  Double-clicking the bare map pings too. Everyone with the map open sees it,
  in red with the pointer's name, and so does the screen when it shows this
  map. Nothing is kept: a ping is not part of the map.
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
  the music player, writing and screen control — requires a login, limited to
  an allow-list of emails. Sign in with any OpenID Connect provider (Microsoft
  Entra ID, Keycloak, Authentik, Authelia, Auth0, Okta, Zitadel, GitLab...),
  GitHub or Google; each one configured gets a button. Sessions are signed
  cookies, no user database.
- A paired screen (`/screen#key=…`, a TV or OBS source with no login) can read
  only what is on it right now: the chart or vista last sent and the images it
  draws, the image sent with "display media", or the images of the battlemap
  shown (without its hidden tokens) — nothing else.
- Set `ENABLE_AUTH=false` to run it open as a single local user.
