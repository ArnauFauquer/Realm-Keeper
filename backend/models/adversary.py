from models.sheet_doc import SheetDoc


class Adversary(SheetDoc):
    """A template: nothing of it changes in play. Each time it is added to an
    encounter it is copied, counters and all (models/encounter.py Combatant)."""
    schema_version: int = 1
