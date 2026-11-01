"""Replaces every ```sheet block of a vault checkout by the link to the
document the app made of it at startup (services/sheet_import.py), e.g.

    ```sheet                     `adversary:Sistemas/Daggerheart/Adversarios/bugboar`
    name: Bugboar          ->
    ...
    ```

Run it once the deployed app has imported the sheets (its log says so), then
commit and push the vault. Delete it afterwards.

    python scripts/sheets_to_documents.py ../RealmKeeperVault
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.sheet_import import rewrite_notes  # noqa: E402

if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    for note in rewrite_notes(Path(sys.argv[1])):
        print(f"rewrote {note}")
