"""One-time move of a bucket into the Observatory's single tree, and of the
notes' image links to the Observatory's URLs. Run it once per bucket (local
MinIO, production Ceph) and once on a checkout of the vault, then delete it.

    old                                               new
    <kind>s/<folders>/<slug>/<kind>.json              observatory/<folders>/<slug>.<kind>.json
    <kind>s/<folders>/.keep                           observatory/<folders>/.keep
    <kind>s/.imported-from-vault                      observatory/.<kind>s-imported-from-vault
    adversaries/.imported-from-notes                  observatory/.imported-from-notes
    asset-library/<folders>/<uid>-<name>              observatory/<folders>/<uid>-<name>
    asset-library/<folders>/<name> (no uid)           observatory/<folders>/<new uid>-<name>
    player/...                                        (stays)

where <kind> is chart, vista, encounter, battlemap, character or adversary.
An image is now served at /api/observatory/images/<uid>-<name>, so every
`/api/asset-library/assets/asset-library/<folders>/<name>` in a document (a
chart's map, a token, a sheet's `image:`...) is rewritten as it is copied, and
`--vault` does the same in the notes. An image that had no uid gets one made
from its old key, the same on every run: the bucket and the notes agree.

Nothing is deleted before its copy is checked, and a run that stops halfway can
be run again. When a document is in both places and they differ, the one saved
last wins (a copy made with --copy-only, then edited by the old version of the
app before the new one was deployed, is refreshed).

    python scripts/migrate_to_observatory.py                 # shows what it would do
    python scripts/migrate_to_observatory.py --copy-only     # copies; the old keys stay
    python scripts/migrate_to_observatory.py --apply         # copies, checks, deletes the old keys
    python scripts/migrate_to_observatory.py --vault ../RealmKeeperVault           # notes: shows
    python scripts/migrate_to_observatory.py --vault ../RealmKeeperVault --apply   # notes: rewrites

It reads the same S3_* settings as the app (S3_ENDPOINT_URL, S3_ACCESS_KEY,
S3_SECRET_KEY, S3_BUCKET_NAME, S3_REGION). The vault is only rewritten on
disk: commit and push it yourself.
"""
import argparse
import hashlib
import json
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, Iterable, List, NamedTuple, Optional, Tuple
from urllib.parse import quote, unquote

# The kinds of document, by the prefix each had (what services/doc_registry.py
# declares as DocType.prefix and .kind: a test checks the two agree).
DOC_PREFIXES: Dict[str, str] = {
    "charts": "chart",
    "vistas": "vista",
    "encounters": "encounter",
    "battlemaps": "battlemap",
    "characters": "character",
    "adversaries": "adversary",
}
OBSERVATORY = "observatory"
ASSET_LIBRARY = "asset-library"
PLAYER = "player"
FOLDER_MARKER = ".keep"
VAULT_MARKER = ".imported-from-vault"
NOTES_MARKER = ".imported-from-notes"
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"}

OLD_URL_PREFIX = f"/api/asset-library/assets/{ASSET_LIBRARY}/"
NEW_URL_PREFIX = "/api/observatory/images/"
_UID_RE = re.compile(r"^[0-9a-f]{8}-.")
# What can follow the old URL prefix in a note: anything up to a space, a quote
# or a bracket. Parentheses stay in (a file can be "Map (1).png"); which part of
# it is the image's path is settled by its extension.
_URL_TAIL = re.compile(r"[^\s\"'<>\[\]{}|\\^`]*")
# In a document the app wrote the URL as it was, spaces and all ("Tierras Del
# Este/map.png"): with the bucket's keys to tell where it ends, only the end of
# the line or a quote stops it.
_URL_TAIL_WITH_SPACES = re.compile(r"[^\r\n\"'<>]*")

# An object this large is copied in parts (S3's single-request limit is 5 GiB).
LARGE_OBJECT = 4 * 1024 ** 3


def _is_image(name: str) -> bool:
    return any(name.lower().endswith(ext) for ext in IMAGE_EXTENSIONS)


def image_filename(old_key: str) -> str:
    """The file name an asset library image gets in the Observatory: its own if
    it starts with a uid, otherwise one prefixed with a uid made from its old
    key (the same every run)."""
    name = old_key.rsplit("/", 1)[-1]
    if _UID_RE.match(name):
        return name
    return f"{hashlib.sha1(old_key.encode('utf-8')).hexdigest()[:8]}-{name}"


def new_image_url(old_key: str) -> str:
    return f"{NEW_URL_PREFIX}{quote(image_filename(old_key), safe='')}"


def destination(key: str) -> Tuple[Optional[str], str]:
    """Where `key` belongs in the new layout, and why: (new key, rule). The new
    key is None for what is already in place or can't be placed."""
    top, _, rest = key.partition("/")
    if top in (OBSERVATORY, PLAYER):
        return None, "in-place"
    if not rest:
        return None, "not-under-a-prefix"
    if top == ASSET_LIBRARY:
        folder, _, name = rest.rpartition("/")
        base = f"{OBSERVATORY}/{folder}/" if folder else f"{OBSERVATORY}/"
        if name == FOLDER_MARKER:
            return f"{base}{FOLDER_MARKER}", "folder"
        if _is_image(name):
            return f"{base}{image_filename(key)}", "image"
        return f"{base}{name}", "other-file"
    if top in DOC_PREFIXES:
        kind = DOC_PREFIXES[top]
        if rest == VAULT_MARKER:
            return f"{OBSERVATORY}/.{top}-imported-from-vault", "marker"
        if rest == NOTES_MARKER:
            return f"{OBSERVATORY}/{NOTES_MARKER}", "marker"
        folder, _, name = rest.rpartition("/")
        if name == FOLDER_MARKER and folder:
            return f"{OBSERVATORY}/{folder}/{FOLDER_MARKER}", "folder"
        if name == f"{kind}.json" and folder:
            return f"{OBSERVATORY}/{folder}.{kind}.json", "document"
    return None, "unknown"


# ── image links ─────────────────────────────────────────────────────────

def rewrite_links(text: str, known: Optional[set] = None, missing: Optional[List[str]] = None) -> Tuple[str, int]:
    """`text` with every link to an asset library image turned into one to the
    same image in the Observatory, and how many it changed. The link may be
    relative or absolute (the host stays), percent-encoded or not. With
    `known` (the asset library's keys), a link to an image that isn't there is
    left alone and added to `missing`."""
    out, count, start = [], 0, 0
    while (found := text.find(OLD_URL_PREFIX, start)) != -1:
        tail = (_URL_TAIL if known is None else _URL_TAIL_WITH_SPACES).match(text, found + len(OLD_URL_PREFIX)).group(0)
        end, old_key = None, None
        # The longest stretch of the tail that decodes to an image's path.
        for length in range(len(tail), 0, -1):
            path = unquote(tail[:length])
            if _is_image(path) and (known is None or f"{ASSET_LIBRARY}/{path}" in known):
                end, old_key = length, f"{ASSET_LIBRARY}/{path}"
                break
        if old_key is None:
            if missing is not None:
                missing.append(OLD_URL_PREFIX + tail)
            out.append(text[start:found + len(OLD_URL_PREFIX)])
            start = found + len(OLD_URL_PREFIX)
            continue
        out.append(text[start:found])
        out.append(new_image_url(old_key))
        count += 1
        start = found + len(OLD_URL_PREFIX) + end
    out.append(text[start:])
    return "".join(out), count


def _rewrite_value(value, known: set, missing: List[str]):
    if isinstance(value, str):
        return rewrite_links(value, known, missing)
    if isinstance(value, list):
        items = [_rewrite_value(item, known, missing) for item in value]
        return [item for item, _ in items], sum(count for _, count in items)
    if isinstance(value, dict):
        items = {key: _rewrite_value(item, known, missing) for key, item in value.items()}
        return {key: item for key, (item, _) in items.items()}, sum(count for _, count in items.values())
    return value, 0


def rewrite_document(text: str, known: set, missing: List[str]) -> Tuple[str, int]:
    """A document's JSON with its image links rewritten (see rewrite_links),
    and how many there were. Unchanged text if there were none."""
    document, count = _rewrite_value(json.loads(text), known, missing)
    if not count:
        return text, 0
    return json.dumps(document, indent=2, ensure_ascii=False), count


# ── the bucket ──────────────────────────────────────────────────────────

class Stored(NamedTuple):
    key: str
    size: int
    etag: str


@dataclass
class Move:
    source: str
    target: str
    rule: str
    size: int


@dataclass
class Plan:
    moves: List[Move] = field(default_factory=list)
    already_there: List[Move] = field(default_factory=list)          # nothing to copy: only the old key is left
    compare: List[Move] = field(default_factory=list)                # documents in both places: settled when copying
    conflicts: List[Tuple[Move, str]] = field(default_factory=list)  # (the move, what is in its way)
    unplaced: List[Tuple[str, str]] = field(default_factory=list)    # (key, why)
    duplicate_uids: List[Tuple[str, str]] = field(default_factory=list)
    in_place: int = 0


def list_objects(client, bucket: str) -> List[Stored]:
    found = []
    for page in client.get_paginator("list_objects_v2").paginate(Bucket=bucket):
        for obj in page.get("Contents", []):
            found.append(Stored(obj["Key"], obj["Size"], (obj.get("ETag") or "").strip('"')))
    return found


def _same(a: Stored, b: Stored) -> bool:
    """Whether two objects are the same content. Their sizes say so for sure
    only when they differ; for a small object the ETag (its MD5) settles it, and
    one uploaded in parts has an ETag that says nothing, so its size has to do."""
    if a.size != b.size:
        return False
    return a.etag == b.etag or "-" in a.etag or "-" in b.etag


def build_plan(objects: Iterable[Stored]) -> Plan:
    stored = {obj.key: obj for obj in objects}
    plan = Plan()
    wanted: Dict[str, str] = {}   # target -> the key that is going there
    uids: Dict[str, str] = {}
    for key in sorted(stored):
        obj = stored[key]
        target, rule = destination(key)
        if target is None:
            if rule == "in-place":
                plan.in_place += 1
            else:
                plan.unplaced.append((key, rule))
            continue
        move = Move(key, target, rule, obj.size)
        if rule == "image":
            uid = target.rsplit("/", 1)[-1][:8]
            if uid in uids:
                plan.duplicate_uids.append((uids[uid], key))
            uids.setdefault(uid, key)
        if target in wanted:
            if rule in ("folder", "marker"):
                plan.already_there.append(move)   # the same empty marker from two kinds
            else:
                plan.conflicts.append((move, f"{wanted[target]} is going there too"))
            continue
        wanted[target] = key
        if target not in stored:
            plan.moves.append(move)
        elif rule in ("folder", "marker"):
            plan.already_there.append(move)       # what is in the new place stays
        elif rule == "document":
            plan.compare.append(move)
        elif _same(obj, stored[target]):
            plan.already_there.append(move)
        else:
            plan.conflicts.append((move, f"{target} exists and differs ({stored[target].size} bytes against {obj.size})"))
    return plan


def describe(plan: Plan) -> str:
    lines = []
    rules = Counter(move.rule for move in [*plan.moves, *plan.already_there, *plan.compare])
    for rule, label in (
        ("document", "documents"), ("image", "images"), ("folder", "folder markers"),
        ("marker", "import markers"), ("other-file", "other files of the asset library"),
    ):
        if rules[rule]:
            lines.append(f"  {rules[rule]:>6}  {label}")
    lines.append(f"  {plan.in_place:>6}  already where they belong")
    if plan.already_there:
        lines.append(f"  {len(plan.already_there):>6}  copied already, only the old key is left")
    if plan.compare:
        lines.append(f"  {len(plan.compare):>6}  documents in both places (the one saved last stays)")
    for move, why in plan.conflicts:
        lines.append(f"  CONFLICT {move.source} -> {move.target}: {why}")
    for first, second in plan.duplicate_uids:
        lines.append(f"  SAME UID {first} and {second}: links to it will show {first}")
    for key, why in plan.unplaced:
        lines.append(f"  LEFT ALONE {key} ({why})")
    return "\n".join(lines)


def _read(client, bucket: str, key: str) -> str:
    return client.get_object(Bucket=bucket, Key=key)["Body"].read().decode("utf-8")


def _put_json(client, bucket: str, key: str, text: str) -> None:
    client.put_object(Bucket=bucket, Key=key, Body=text.encode("utf-8"), ContentType="application/json")


def _saved_at(text: str) -> str:
    try:
        return json.loads(text).get("updated_at") or ""
    except (ValueError, AttributeError):
        return ""


def _copy(client, bucket: str, move: Move) -> None:
    source = {"Bucket": bucket, "Key": move.source}
    if move.size >= LARGE_OBJECT:
        client.copy(source, bucket, move.target)   # boto3's managed, multipart copy
    else:
        client.copy_object(Bucket=bucket, CopySource=source, Key=move.target)
    copied = client.head_object(Bucket=bucket, Key=move.target)["ContentLength"]
    if copied != move.size:
        raise RuntimeError(f"{move.target} is {copied} bytes, but {move.source} is {move.size}")


def execute(client, bucket: str, plan: Plan, known: set, write: bool, delete_sources: bool, log=print) -> Dict[str, int]:
    """Copies what needs copying (documents with their links rewritten), and
    with `delete_sources` removes the old keys. Without `write`, only counts
    and reports what it would do. Returns the counts."""
    counts = Counter()
    for move in [*plan.moves, *plan.compare]:
        if move.rule != "document":
            if write:
                _copy(client, bucket, move)
            counts["copied"] += 1
        else:
            missing: List[str] = []
            text, links = rewrite_document(_read(client, bucket, move.source), known, missing)
            for url in missing:
                log(f"  {move.source}: {url} is not in the bucket; left as it is")
            counts["links"] += links
            if move in plan.compare:
                there = _read(client, bucket, move.target)
                if there == text or _saved_at(there) >= _saved_at(text):
                    counts["kept"] += 1
                    log(f"  {move.target} stays: saved at {_saved_at(there) or '?'}, the old one at {_saved_at(text) or '?'}")
                else:
                    counts["refreshed"] += 1
                    log(f"  {move.target} {'is' if write else 'would be'} refreshed from {move.source}, saved later")
                    if write:
                        _put_json(client, bucket, move.target, text)
            else:
                counts["copied"] += 1
                if write:
                    _put_json(client, bucket, move.target, text)
        if delete_sources:
            client.delete_object(Bucket=bucket, Key=move.source)
        if counts["copied"] and counts["copied"] % 100 == 0 and write:
            log(f"  ... {counts['copied']} of {len(plan.moves)}")
    if delete_sources:
        for move in plan.already_there:
            client.delete_object(Bucket=bucket, Key=move.source)
            counts["removed"] += 1
    return counts


def migrate_bucket(args) -> int:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from config.settings import settings
    from services import storage_service

    if not settings.S3_ENDPOINT_URL:
        print("S3_ENDPOINT_URL is not set: there is no bucket to move.", file=sys.stderr)
        return 2
    bucket = settings.S3_BUCKET_NAME
    client = storage_service._client()
    print(f"Bucket {bucket!r} at {settings.S3_ENDPOINT_URL}")

    objects = list_objects(client, bucket)
    known = {obj.key for obj in objects if obj.key.startswith(f"{ASSET_LIBRARY}/")}
    plan = build_plan(objects)
    print(describe(plan))
    if plan.conflicts:
        print("\nResolve the conflicts above (nothing was changed), then run it again.", file=sys.stderr)
        return 1
    keys = len(plan.moves) + len(plan.compare) + len(plan.already_there)
    if not (args.apply or args.copy_only):
        counts = execute(client, bucket, plan, known, write=False, delete_sources=False)
        print(f"\n{keys} key(s) to move, {counts['links']} image link(s) in documents to rewrite."
              " This was a dry run: add --copy-only or --apply to change something.")
        return 0
    if not args.yes and input(f"\nMove {keys} key(s) in this bucket? [y/N] ").strip().lower() != "y":
        print("Nothing changed.")
        return 1
    counts = execute(client, bucket, plan, known, write=True, delete_sources=args.apply)
    print(f"Copied {counts['copied']} key(s), rewrote {counts['links']} image link(s),"
          f" refreshed {counts['refreshed']} and kept {counts['kept']} document(s) that were in both places"
          f"{'; the old keys are gone' if args.apply else '; the old keys are still there'}.")
    return 0


# ── the notes ───────────────────────────────────────────────────────────

def note_files(vault: Path) -> List[Path]:
    return sorted(
        path for path in vault.rglob("*.md")
        if not any(part.startswith(".") for part in path.relative_to(vault).parts)
    )


def migrate_vault(args, log: Callable[[str], None] = print) -> int:
    vault = Path(args.vault)
    if not vault.is_dir():
        print(f"{vault} is not a directory", file=sys.stderr)
        return 2
    notes, links = 0, 0
    for path in note_files(vault):
        text = path.read_text(encoding="utf-8")
        rewritten, count = rewrite_links(text)
        if not count:
            continue
        notes += 1
        links += count
        log(f"  {path.relative_to(vault).as_posix()}: {count} image link(s)")
        if args.apply:
            path.write_text(rewritten, encoding="utf-8")
    verb = "Rewrote" if args.apply else "Would rewrite"
    log(f"{verb} {links} image link(s) in {notes} note(s)."
        f"{' Commit and push the vault.' if args.apply and notes else ''}"
        f"{'' if args.apply else ' Add --apply to write them.'}")
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Move a bucket (or a vault's notes) to the Observatory.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="copy, check the copies, delete the old keys (with --vault: rewrite the notes)")
    mode.add_argument("--copy-only", action="store_true", help="copy and check; keep the old keys")
    parser.add_argument("--vault", help="rewrite the image links of the notes in this checkout of the vault, instead of the bucket")
    parser.add_argument("--yes", action="store_true", help="don't ask before changing anything")
    args = parser.parse_args(argv)
    if args.vault:
        if args.copy_only:
            parser.error("--copy-only is for the bucket")
        return migrate_vault(args)
    return migrate_bucket(args)


if __name__ == "__main__":
    sys.exit(main())
