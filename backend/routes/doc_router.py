"""The HTTP routes of a kind of document, generated from its DocType: the list,
create, folder, move, rename, read, save and delete routes, the ones that set
its images, and — for live documents — the commands that edit them (see
services/sync_hub.py).

Every route needs a signed-in user, except reading a document, which `viewer`
decides (a paired screen may read what is on screen).
"""
import asyncio
import functools
import logging
from typing import Any, Awaitable, Callable, Dict, List, Optional

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from routes.auth import current_user, require_auth
from routes.errors import storage_unavailable
from services import doc_commands
from services.doc_collection import DocCollection, DocNotFound
from services.doc_paths import sanitize_folder_name
from services.doc_type import DocType
from services.sync_hub import DocHub

logger = logging.getLogger(__name__)


def login_only(request: Request, doc_id: str) -> None:
    if not current_user(request):
        raise HTTPException(status_code=401, detail="Not authenticated")


def guarded(handler):
    """Turns what a handler raises into the HTTP error it means."""
    @functools.wraps(handler)
    async def wrapper(*args, **kwargs):
        try:
            return await handler(*args, **kwargs)
        except DocNotFound as e:
            raise HTTPException(status_code=404, detail=str(e))
        except PermissionError:
            raise HTTPException(status_code=403, detail="Not allowed")
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except (ClientError, BotoCoreError) as e:
            raise storage_unavailable(logger, e)
    return wrapper


class CreateBody(BaseModel):
    name: str
    description: Optional[str] = None
    folder_path: str = ""


class FolderBody(BaseModel):
    path: str


class FolderRenameBody(BaseModel):
    name: str


class FolderMoveBody(BaseModel):
    path: str
    dest_parent_path: str = ""


class MoveBody(BaseModel):
    id: str
    folder_path: str = ""


class RenameBody(BaseModel):
    id: str
    name: str


class UrlBody(BaseModel):
    url: str


class ItemsBody(BaseModel):
    items: List[Dict[str, Any]] = Field(max_length=200)
    # Adding what is already there is not an error.
    ignore_existing: bool = False


class OrderBody(BaseModel):
    ids: List[str] = Field(max_length=500)


class AdjustBody(BaseModel):
    resource: str
    by: int = Field(ge=-1000, le=1000)


def make_doc_router(
    doctype: DocType, collection: DocCollection, hub: DocHub,
    viewer: Callable[[Request, str], None] = login_only,
    on_moved: Optional[Callable[[Dict[str, str], dict], Awaitable[None]]] = None,
) -> APIRouter:
    """`on_moved({old_id: new_id}, user)` is awaited once documents have been
    given another id (moved, or their folder renamed or moved): whatever
    refers to them by id follows."""
    router = APIRouter(prefix=f"/api/{doctype.prefix}", tags=[doctype.prefix])
    kind = doctype.kind
    # Ahead of every route that belongs to one document.
    on = "/{doc_id:path}"

    async def blocking(fn, *args):
        return await asyncio.to_thread(fn, *args)

    async def change(doc_id: str, user: dict, command: str, fn: Callable[[Dict[str, Any]], None]) -> Dict[str, Any]:
        event = await hub.mutate(kind, doc_id, fn, user=user, command=command)
        return event or {"type": "noop"}

    async def forget_under(folder: str) -> List[str]:
        """Lets go of every live document inside a folder that is about to move
        or go, and returns the ids of all its documents (see `discard`)."""
        folder = folder.strip("/")
        ids = [meta.id for meta in await blocking(collection.list_all) if meta.id.startswith(f"{folder}/")]
        if doctype.live:
            for doc_id in ids:
                await hub.forget(kind, doc_id)
        return ids

    async def moved(moves: Dict[str, str], user: dict) -> None:
        moves = {old: new for old, new in moves.items() if old != new}
        if on_moved and moves:
            await on_moved(moves, user)

    def folder_moves(ids: List[str], old_folder: str, new_folder: str) -> Dict[str, str]:
        old_folder = old_folder.strip("/")
        return {doc_id: f"{new_folder}{doc_id[len(old_folder):]}" for doc_id in ids}

    def renamed_folder(path: str, name: Optional[str] = None, parent: Optional[str] = None) -> str:
        """Where a folder ends up (DocCollection.move_folder decides the same)."""
        path = path.strip("/")
        old_parent, _, leaf = path.rpartition("/")
        parent = old_parent if parent is None else parent.strip("/")
        leaf = leaf if name is None else sanitize_folder_name(name)
        return f"{parent}/{leaf}" if parent else leaf

    def discard(ids: List[str]) -> None:
        """Once the documents are moved or deleted: a command that arrived in
        between has loaded them again from where they were, and must not save
        them back there."""
        for doc_id in ids:
            hub.discard(kind, doc_id)

    # Declared ahead of the "/{doc_id:path}" routes below: those would
    # otherwise swallow "/folders/..." and "/all" as a document id.

    @router.get("")
    @guarded
    async def list_tree(path: str = "", user: dict = Depends(require_auth)):
        return await blocking(collection.list_tree, path)

    @router.get("/all")
    @guarded
    async def list_all(user: dict = Depends(require_auth)):
        return {doctype.items_key: await blocking(collection.list_all)}

    @router.post("/rename")
    @guarded
    async def rename(body: RenameBody, user: dict = Depends(require_auth)):
        if doctype.live:
            name = body.name.strip()
            if not name:
                raise ValueError("A name is required")
            return await change(body.id.strip("/"), user, "rename", lambda d: d.update(name=name))
        return await blocking(collection.rename, body.id, body.name)

    @router.post("")
    @guarded
    async def create(body: CreateBody, user: dict = Depends(require_auth)):
        return await blocking(collection.create, body.name, body.description, body.folder_path)

    @router.post("/folders")
    @guarded
    async def create_folder(body: FolderBody, user: dict = Depends(require_auth)):
        await blocking(collection.create_folder, body.path)
        return {"status": "success"}

    @router.post("/folders/move")
    @guarded
    async def move_folder(body: FolderMoveBody, user: dict = Depends(require_auth)):
        gone = await forget_under(body.path)
        await blocking(collection.move_folder, body.path, body.dest_parent_path, None)
        discard(gone)
        await moved(folder_moves(gone, body.path, renamed_folder(body.path, parent=body.dest_parent_path)), user)
        return {"status": "success"}

    @router.put("/folders/{path:path}")
    @guarded
    async def rename_folder(path: str, body: FolderRenameBody, user: dict = Depends(require_auth)):
        gone = await forget_under(path)
        await blocking(collection.move_folder, path, None, body.name)
        discard(gone)
        await moved(folder_moves(gone, path, renamed_folder(path, name=body.name)), user)
        return {"status": "success"}

    @router.delete("/folders/{path:path}")
    @guarded
    async def delete_folder(path: str, user: dict = Depends(require_auth)):
        gone = await forget_under(path)
        await blocking(collection.delete_folder, path)
        discard(gone)
        return {"status": "success"}

    @router.post("/move")
    @guarded
    async def move_item(body: MoveBody, user: dict = Depends(require_auth)):
        old_id = body.id.strip("/")
        if doctype.live:
            await hub.forget(kind, old_id)
        new_id = await blocking(collection.move_item, body.id, body.folder_path)
        if doctype.live:
            discard([old_id])
        await moved({old_id: new_id}, user)
        return {"status": "success", "id": new_id}

    def add_collection_routes(name: str) -> None:
        # Literal names, not a {collection} parameter: a document id can contain
        # slashes, so only a fixed word tells where it ends. Declared ahead of
        # the "/{doc_id:path}" routes below, which would otherwise swallow them.

        @router.post(f"{on}/{name}/order", name=f"order_{name}")
        @guarded
        async def order(body: OrderBody, doc_id: str, user: dict = Depends(require_auth)):
            return await change(doc_id, user, "order", lambda d: doc_commands.order_items(d, doctype, name, body.ids))

        @router.post(f"{on}/{name}/{{entity_id}}/adjust", name=f"adjust_{name}")
        @guarded
        async def adjust(entity_id: str, body: AdjustBody, doc_id: str, user: dict = Depends(require_auth)):
            return await change(
                doc_id, user, "adjust",
                lambda d: doc_commands.adjust_resource(d, doctype, name, entity_id, body.resource, body.by),
            )

        @router.patch(f"{on}/{name}/{{entity_id}}", name=f"patch_{name}")
        @guarded
        async def patch_item(entity_id: str, body: Dict[str, Any], doc_id: str, user: dict = Depends(require_auth)):
            return await change(
                doc_id, user, "patch_item", lambda d: doc_commands.patch_item(d, doctype, name, entity_id, body),
            )

        @router.delete(f"{on}/{name}/{{entity_id}}", name=f"remove_{name}")
        @guarded
        async def remove_item(entity_id: str, doc_id: str, user: dict = Depends(require_auth)):
            return await change(doc_id, user, "remove_item", lambda d: doc_commands.remove_item(d, doctype, name, entity_id))

        @router.post(f"{on}/{name}", name=f"add_{name}")
        @guarded
        async def add_items(body: ItemsBody, doc_id: str, user: dict = Depends(require_auth)):
            return await change(
                doc_id, user, "add_items", lambda d: doc_commands.add_items(d, doctype, name, body.items, body.ignore_existing),
            )

    if doctype.live:
        for collection_name in doctype.collections:
            add_collection_routes(collection_name)

        if doctype.resources_field:
            @router.post(f"{on}/adjust")
            @guarded
            async def adjust_own(doc_id: str, body: AdjustBody, user: dict = Depends(require_auth)):
                return await change(
                    doc_id, user, "adjust", lambda d: doc_commands.adjust_own_resource(d, doctype, body.resource, body.by),
                )

        if doctype.patchable:
            @router.patch(on)
            @guarded
            async def patch_doc(doc_id: str, body: Dict[str, Any], user: dict = Depends(require_auth)):
                return await change(doc_id, user, "patch", lambda d: doc_commands.patch_doc(d, doctype, body))

    @router.get(on)
    @guarded
    async def get_doc(request: Request, doc_id: str):
        viewer(request, doc_id)
        if doctype.live:
            return await hub.snapshot(kind, doc_id)
        doc = await blocking(collection.get, doc_id)
        if doc is None:
            raise DocNotFound(f"{kind.capitalize()} not found: {doc_id}")
        return doc

    if not doctype.live:
        @router.put(on)
        @guarded
        async def save(doc_id: str, body: Dict[str, Any], user: dict = Depends(require_auth)):
            return await blocking(collection.save, doc_id, body)

    @router.delete(on)
    @guarded
    async def delete(doc_id: str, user: dict = Depends(require_auth)):
        doc_id = doc_id.strip("/")
        if doctype.live:
            await hub.forget(kind, doc_id)
        await blocking(collection.delete, doc_id)
        if doctype.live:
            discard([doc_id])
        return {"status": "success"}

    def add_asset_route(route: str, field_name: str) -> None:
        @router.post(f"{on}/{route}", name=f"set_{route}")
        @guarded
        async def set_asset(doc_id: str, body: UrlBody, user: dict = Depends(require_auth)):
            return await blocking(collection.set_field, doc_id, field_name, body.url)

    for route_name, field in doctype.asset_routes.items():
        add_asset_route(route_name, field)

    return router
