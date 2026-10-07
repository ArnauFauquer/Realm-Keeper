# How data is stored

| Data                      | Where                                                       |
| ------------------------- | ----------------------------------------------------------- |
| Notes                     | `.md` files in the vault (a folder, or a Git repository)    |
| Audio (the player)        | `player/<album>/<track>` in the store                       |
| Documents                 | `observatory/<folders>/<slug>.<kind>.json` in the store     |
| Images                    | `observatory/<folders>/<uid>-<name>` in the store           |

where `<kind>` is `chart`, `vista`, `encounter`, `battlemap`, `character` or
`adversary`. The store is a folder (`STORAGE_BACKEND=local`, at
`STORAGE_LOCAL_PATH`) or any S3-compatible bucket (`STORAGE_BACKEND=s3`: MinIO,
Ceph RGW, AWS S3…), laid out the same way, with those two top-level prefixes and
nothing else at the top: moving from one to the other is copying the files
(`aws s3 sync <folder> s3://<bucket>`, or `mc mirror`). A document's id is
its folders and slug (`Hijos del Fango/Acto 2/emboscada`), which is how a note
links to it; an image is served at `/api/observatory/images/<uid>-<name>`.

**The vault, two ways:**
- **A folder** (the default, without `REPO_URL`): your Obsidian vault mounted as
  a volume, say. A note saved in the app is written to its file, nothing more,
  and what Obsidian (or anything else) changes there shows in the app within
  `VAULT_WATCH_INTERVAL` seconds. Keep it backed up however you already do
  (Obsidian Sync, Syncthing, the Obsidian Git plugin...).
- **A Git repository** (`REPO_URL`, or `GIT_ENABLED=true`): the backend clones
  it on startup, pulls every `GIT_SYNC_INTERVAL` seconds, and commits and pushes
  every edit made to a note in the app. You can keep editing the same vault in
  Obsidian — both sides stay in sync through Git. Works where the app has no
  disk that lasts (a Kubernetes `emptyDir`).

Everything else is not in the vault: a map or a fight changes while people play.
Those documents are JSON files in the store, one write per save, with no lock and
no commit.
Charts, vistas and adversaries are edited whole and saved with a button;
encounters, battlemaps and characters are *live*: held in memory while someone
is using them and written a couple of seconds after the last change (and when the app shuts
down). Don't redeploy in the middle of a session: the new pod would load the
last saved copy.

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
