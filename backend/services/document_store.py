"""A single JSON document per item (vista.json, chart.json, ...), living at
<tree.root>/<id>/<item_filename> and git-committed on every write. Pairs
with a FolderTree for the folder side of that same directory structure —
VistaService/ChartService each wrap one of these with their own model
validation and field shape, since a Vista and a Chart don't share a schema,
only the read/write/delete mechanics around their JSON file did."""
import json
import shutil
from typing import Optional

from services.folder_tree import FolderTree
from services.git_sync_utils import GitCommitError, commit_and_push


class DocumentStoreError(Exception):
    """Raised when writing or deleting a document fails to save to git."""
    pass


class DocumentStore:
    def __init__(self, tree: FolderTree):
        self.tree = tree

    def item_file(self, item_id: str):
        return self.tree.item_dir(item_id) / self.tree.item_filename

    def read_raw(self, item_id: str) -> Optional[dict]:
        item_file = self.item_file(item_id)
        if not item_file.exists():
            return None
        return json.loads(item_file.read_text(encoding="utf-8"))

    def unique_slug(self, base_slug: str, folder_path: str) -> str:
        base_dir = (self.tree.root / folder_path) if folder_path else self.tree.root
        slug = base_slug
        suffix = 2
        while (base_dir / slug / self.tree.item_filename).exists():
            slug = f"{base_slug}-{suffix}"
            suffix += 1
        return slug

    def write(self, item_id: str, json_text: str, author_name: str, author_email: str, message: str) -> None:
        item_file = self.item_file(item_id)
        item_file.parent.mkdir(parents=True, exist_ok=True)
        item_file.write_text(json_text, encoding="utf-8")

        rel_path = str(item_file.relative_to(self.tree.vault_path.resolve()))
        try:
            commit_and_push(
                self.tree.vault_path, self.tree.git_lock, [rel_path],
                message=message, author_name=author_name, author_email=author_email,
            )
        except GitCommitError as e:
            raise DocumentStoreError(str(e))

    def delete(self, item_id: str, author_name: str, author_email: str, message: str, not_found_message: str) -> None:
        item_file = self.item_file(item_id)
        if not item_file.exists():
            raise ValueError(not_found_message)

        item_dir = item_file.parent
        rel_dir = str(item_dir.relative_to(self.tree.vault_path.resolve()))
        shutil.rmtree(item_dir)
        try:
            commit_and_push(
                self.tree.vault_path, self.tree.git_lock, [rel_dir],
                message=message, author_name=author_name, author_email=author_email,
            )
        except GitCommitError as e:
            raise DocumentStoreError(str(e))
