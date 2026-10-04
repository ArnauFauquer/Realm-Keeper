"""One-time move of an existing bucket to the current layout. Run it once per
bucket (local MinIO, production Ceph), then delete it.

    old                                          new
    <album>/<track>                              player/<album>/<track>
    docs/<kind>/<folders>/<id>/<kind>.json       <kind>/<folders>/<id>/<kind>.json
    docs/.imported/<kind>                        <kind>/.imported-from-vault
    charts/<id>/map|pins/..., vistas/<id>/...    asset-library/Legacy/charts|vistas/<id>/...
                                                 (what charts and vistas kept in the bucket
                                                 before the asset library; see below)
    asset-library/...                            (stays: notes and documents refer to it by URL)
    [docs/]characters/all/characters.json        characters/<id>/character.json, one per character

where <kind> is charts, vistas, encounters, battlemaps or characters.

The old `charts/` and `vistas/` held images, which is where the new document
kinds of the same name go: the images are moved into the asset library (under
`Legacy/`), and the few documents that still name them by their old URL
(`/api/vistas/assets/vistas/...`, which nothing serves any more) are pointed at
the new place.

Nothing is overwritten, and nothing is deleted before its copy is checked, so
a run that stops halfway can simply be run again.

    python scripts/migrate_storage_layout.py                # shows what it would do
    python scripts/migrate_storage_layout.py --copy-only    # copies; the old keys stay
    python scripts/migrate_storage_layout.py --apply        # copies, checks, deletes the old keys

It reads the same S3_* settings as the app (S3_ENDPOINT_URL, S3_ACCESS_KEY,
S3_SECRET_KEY, S3_BUCKET_NAME, S3_REGION). Documents are only rewritten by
--apply, once they are in their new place.
"""
import argparse
import json
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, NamedTuple, Optional, Tuple
from urllib.parse import unquote

# The kinds of document, and the file each keeps its content in (what
# services/doc_registry.py declares: a test checks the two agree).
DOC_KINDS: Dict[str, str] = {
    "charts": "chart.json",
    "vistas": "vista.json",
    "encounters": "encounter.json",
    "battlemaps": "battlemap.json",
    "characters": "character.json",
}
# Before the asset library, charts and vistas kept their images in the bucket
# under their own names. Nothing else ever did, so a top-level `encounters/`,
# `battlemaps/` or `characters/` that is not a document can only be an album.
LEGACY_IMAGE_KINDS = ("charts", "vistas")
PLAYER = "player"
ASSET_LIBRARY = "asset-library"
LEGACY_IMAGES_FOLDER = f"{ASSET_LIBRARY}/Legacy"
IMPORT_MARKER = ".imported-from-vault"
# Every character's saved values used to be one document; now each has its own.
SHARED_CHARACTERS = ("docs/characters/all/characters.json", "characters/all/characters.json")
FOLDER_MARKER = ".keep"

# What an image of the old scheme was served at ("/api/vistas/assets/vistas/<id>/...").
_OLD_IMAGE_URL = re.compile(r"^/api/(charts|vistas)/assets/\1/(.+)$")
_LIBRARY_URL = "/api/asset-library/assets/"

# An object this large is copied in parts (S3's single-request limit is 5 GiB).
LARGE_OBJECT = 4 * 1024 ** 3


class Stored(NamedTuple):
    key: str
    size: int
    etag: str


def destination(key: str) -> Tuple[Optional[str], str]:
    """Where `key` belongs in the new layout, and why: (new key, rule). The new
    key is None for what is already in place or can't be placed."""
    if key in SHARED_CHARACTERS:
        return None, "characters-to-split"
    top, _, rest = key.partition("/")
    if not rest:
        return None, "not-under-a-prefix"
    if top == "docs":
        kind, _, tail = rest.partition("/")
        if kind == ".imported":
            marker_kind = tail.split("/")[0]
            if marker_kind in DOC_KINDS:
                return f"{marker_kind}/{IMPORT_MARKER}", "document-marker"
            return None, "unknown-under-docs"
        if kind in DOC_KINDS and tail:
            return rest, "document"
        return None, "unknown-under-docs"
    if top == ASSET_LIBRARY:
        return None, "in-place"
    if top == PLAYER:
        # An album could have been called "player": its tracks sit one level
        # down, where an album's folder would be.
        return (f"{PLAYER}/{key}", "album") if "/" not in rest else (None, "in-place")
    if top in DOC_KINDS:
        # A document, or a folder's marker, is at least a level down (a
        # document sits in a folder of its own); the import marker is the one
        # thing directly in the prefix. Anything else directly in it is a track.
        if rest == IMPORT_MARKER or ("/" in rest and rest.rsplit("/", 1)[-1] in (DOC_KINDS[top], FOLDER_MARKER)):
            return None, "in-place"
        if top in LEGACY_IMAGE_KINDS:
            return f"{LEGACY_IMAGES_FOLDER}/{key}", "legacy-image"
    return f"{PLAYER}/{key}", "album"


@dataclass
class Move:
    source: str
    target: str
    rule: str
    size: int


@dataclass
class Plan:
    moves: List[Move] = field(default_factory=list)
    already_there: List[Move] = field(default_factory=list)       # copied before: only the old key is left
    conflicts: List[Tuple[Move, str]] = field(default_factory=list)  # (the move, what is in its way)
    unplaced: List[Tuple[str, str]] = field(default_factory=list)    # (key, why)
    character_documents: List[str] = field(default_factory=list)      # to split, one file per character
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
    for key in sorted(stored):
        obj = stored[key]
        target, rule = destination(key)
        if target is None:
            if rule == "in-place":
                plan.in_place += 1
            elif rule == "characters-to-split":
                plan.character_documents.append(key)
            else:
                plan.unplaced.append((key, rule))
            continue
        move = Move(key, target, rule, obj.size)
        if target in wanted:
            plan.conflicts.append((move, f"{wanted[target]} is going there too"))
        elif target in stored:
            if _same(obj, stored[target]):
                plan.already_there.append(move)
            else:
                plan.conflicts.append((move, f"{target} exists and differs ({stored[target].size} bytes against {obj.size})"))
            wanted[target] = key
        else:
            plan.moves.append(move)
            wanted[target] = key
    return plan


def describe(plan: Plan) -> str:
    lines = []
    rules = Counter(move.rule for move in [*plan.moves, *plan.already_there])
    for rule, label in (
        ("album", "audio into player/"),
        ("document", "documents out of docs/"),
        ("document-marker", "import markers"),
        ("legacy-image", "old chart/vista images into asset-library/Legacy/"),
    ):
        if rules[rule]:
            lines.append(f"  {rules[rule]:>6}  {label}")
    if plan.character_documents:
        lines.append(f"  {len(plan.character_documents):>6}  shared characters document(s) to split, one file per character")
    lines.append(f"  {plan.in_place:>6}  already where they belong")
    if plan.already_there:
        lines.append(f"  {len(plan.already_there):>6}  copied already, only the old key is left")
    for move, why in plan.conflicts:
        lines.append(f"  CONFLICT {move.source} -> {move.target}: {why}")
    for key, why in plan.unplaced:
        lines.append(f"  LEFT ALONE {key} ({why})")
    return "\n".join(lines)


def _copy(client, bucket: str, move: Move) -> None:
    source = {"Bucket": bucket, "Key": move.source}
    if move.size >= LARGE_OBJECT:
        client.copy(source, bucket, move.target)   # boto3's managed, multipart copy
    else:
        client.copy_object(Bucket=bucket, CopySource=source, Key=move.target)


def _check_copy(client, bucket: str, move: Move) -> None:
    copied = client.head_object(Bucket=bucket, Key=move.target)["ContentLength"]
    if copied != move.size:
        raise RuntimeError(f"{move.target} is {copied} bytes, but {move.source} is {move.size}")


def execute(client, bucket: str, plan: Plan, delete_sources: bool, log=print) -> int:
    """Copies what needs copying, checking each copy, and with `delete_sources`
    removes the old keys. Returns how many keys were copied."""
    copied = 0
    for move in plan.moves:
        _copy(client, bucket, move)
        _check_copy(client, bucket, move)
        copied += 1
        if delete_sources:
            client.delete_object(Bucket=bucket, Key=move.source)
        if copied % 50 == 0:
            log(f"  ... {copied} of {len(plan.moves)}")
    if delete_sources:
        for move in plan.already_there:
            _check_copy(client, bucket, move)
            client.delete_object(Bucket=bucket, Key=move.source)
    return copied


def _point_at_the_library(value, present: set, missing: list):
    """`value` (a document, or part of one) with every URL of the old image
    scheme that names an image now in the library turned into the library's
    URL for it. Returns (the value, how many it changed); an image that is not
    in the bucket is added to `missing` and left as it was."""
    if isinstance(value, str):
        match = _OLD_IMAGE_URL.match(value)
        if not match:
            return value, 0
        kind, rest = match.groups()
        new_key = f"{LEGACY_IMAGES_FOLDER}/{kind}/{unquote(rest)}"
        if new_key not in present:
            missing.append(value)
            return value, 0
        return f"{_LIBRARY_URL}{LEGACY_IMAGES_FOLDER}/{kind}/{rest}", 1
    if isinstance(value, list):
        items = [_point_at_the_library(item, present, missing) for item in value]
        return [item for item, _ in items], sum(count for _, count in items)
    if isinstance(value, dict):
        items = {key: _point_at_the_library(item, present, missing) for key, item in value.items()}
        return {key: item for key, (item, _) in items.items()}, sum(count for _, count in items.values())
    return value, 0


def rewrite_documents(client, bucket: str, apply: bool, log=print) -> int:
    """Points the documents that name an image of the old scheme at the image
    where it now is. Returns how many documents changed (or would). A document
    that has not been moved yet is read where it is. A reference to an image
    that is not in the bucket (it was lost long ago) is reported and left."""
    stored = list_objects(client, bucket)
    # What will be in the library: what is there, and what the plan puts there.
    present = {obj.key for obj in stored} | {destination(obj.key)[0] for obj in stored if destination(obj.key)[1] == "legacy-image"}
    changed = 0
    for obj in stored:
        where = destination(obj.key)[0] or obj.key
        kind, _, _tail = where.partition("/")
        if kind not in DOC_KINDS or not where.endswith(f"/{DOC_KINDS[kind]}"):
            continue
        document = json.loads(client.get_object(Bucket=bucket, Key=obj.key)["Body"].read().decode("utf-8"))
        missing: List[str] = []
        updated, count = _point_at_the_library(document, present, missing)
        for url in missing:
            log(f"  {obj.key}: {url} is not in the bucket; left as it is")
        if not count:
            continue
        changed += 1
        log(f"  {obj.key}: {count} image reference(s) {'rewritten' if apply else 'to rewrite'}")
        if apply:
            body = json.dumps(updated, indent=2, ensure_ascii=False).encode("utf-8")
            client.put_object(Bucket=bucket, Key=obj.key, Body=body, ContentType="application/json")
    return changed


def split_characters(client, bucket: str, sources: List[str], write: bool, delete_sources: bool, log=print) -> int:
    """Gives each character of the old shared document its own document,
    characters/<id>/character.json. Returns how many it wrote (or would).

    One that already has its own document keeps it if it has been changed
    there (rev above 0): the app made it from the sheet and someone has used it
    since. One the app only just made from the sheet (rev 0) takes the saved
    values, which are the real ones."""
    written = 0
    for key in sources:
        shared = json.loads(client.get_object(Bucket=bucket, Key=key)["Body"].read().decode("utf-8"))
        for state in shared.get("characters", []):
            character_id = state.get("id")
            if not character_id:
                continue
            target = f"characters/{character_id}/character.json"
            try:
                existing = json.loads(client.get_object(Bucket=bucket, Key=target)["Body"].read().decode("utf-8"))
            except Exception:
                existing = None
            if existing is not None and existing.get("rev", 0) > 0:
                log(f"  {target} has been used since it was made: kept, the old values of {character_id} are not copied")
                continue
            document = {
                **{k: v for k, v in state.items() if k not in ("updated_at",)},
                "id": character_id,
                "name": (existing or {}).get("name") or state.get("name") or character_id,
                "schema_version": 2,
                "rev": 0,
            }
            written += 1
            log(f"  {key} -> {target}{' (replacing the one made from the sheet)' if existing else ''}")
            if write:
                client.put_object(
                    Bucket=bucket, Key=target, ContentType="application/json",
                    Body=json.dumps(document, indent=2, ensure_ascii=False).encode("utf-8"),
                )
        if delete_sources:
            client.delete_object(Bucket=bucket, Key=key)
    return written


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Move a bucket to the current storage layout.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="copy, check the copies, delete the old keys, point old image references at the new place")
    mode.add_argument("--copy-only", action="store_true", help="copy and check; keep the old keys, rewrite nothing")
    parser.add_argument("--yes", action="store_true", help="don't ask before changing anything")
    args = parser.parse_args(argv)

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from config.settings import settings
    from services import storage_service

    if not settings.S3_ENDPOINT_URL:
        print("S3_ENDPOINT_URL is not set: there is no bucket to move.", file=sys.stderr)
        return 2
    bucket = settings.S3_BUCKET_NAME
    client = storage_service._client()
    print(f"Bucket {bucket!r} at {settings.S3_ENDPOINT_URL}")

    plan = build_plan(list_objects(client, bucket))
    print(describe(plan))
    if plan.conflicts:
        print("\nResolve the conflicts above (nothing was changed), then run it again.", file=sys.stderr)
        return 1
    keys = len(plan.moves) + len(plan.already_there)
    if not (args.apply or args.copy_only):
        rewrites = rewrite_documents(client, bucket, apply=False)
        characters = split_characters(client, bucket, plan.character_documents, write=False, delete_sources=False)
        print(f"\n{keys} key(s) to move, {rewrites} document(s) to point at the new images,"
              f" {characters} character(s) to give their own document."
              " This was a dry run: add --copy-only or --apply to change something.")
        return 0
    if not args.yes and input(f"\nMove {keys} key(s) in this bucket? [y/N] ").strip().lower() != "y":
        print("Nothing changed.")
        return 1

    copied = execute(client, bucket, plan, delete_sources=args.apply)
    print(f"Copied {copied} key(s){' and removed their old keys' if args.apply else ' (the old keys are still there)'}.")
    # The shared characters document may only now be in its place (moved out of docs/).
    after = build_plan(list_objects(client, bucket)).character_documents if args.apply else plan.character_documents
    characters = split_characters(client, bucket, after, write=True, delete_sources=args.apply)
    print(f"Gave {characters} character(s) their own document"
          f"{' and removed the shared one' if args.apply and after else ''}.")
    if args.apply:
        print(f"Pointed {rewrite_documents(client, bucket, apply=True)} document(s) at the new images.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
