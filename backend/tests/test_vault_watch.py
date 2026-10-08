"""The vault watch (main._watch_vault): notes changed on disk, by a pull or by
Obsidian, are reloaded and every open page is told, git or not.
Run from backend/:  python -m pytest tests/test_vault_watch.py
"""
import asyncio

import main


def test_a_change_on_disk_drops_the_caches_and_tells_the_pages(monkeypatch):
    fingerprints = iter(["a", "a", "b", "b", "b", "b", "b", "b", "b", "b"])
    announced, invalidated = [], []
    monkeypatch.setattr(main.settings, "VAULT_WATCH_INTERVAL", 0.001)
    monkeypatch.setattr(main.md_service_instance, "fingerprint", lambda: next(fingerprints, "b"))
    monkeypatch.setattr(main.md_service_instance, "invalidate_cache", lambda *a: invalidated.append(a))

    async def announce(message):
        announced.append(message)
    monkeypatch.setattr(main.doc_hub, "announce", announce)

    async def scenario():
        watch = asyncio.create_task(main._watch_vault())
        await asyncio.sleep(0.2)
        watch.cancel()

    asyncio.run(scenario())
    # Once for the one change, not again while it stays the same.
    assert announced == [{"type": "notes"}]
    assert len(invalidated) == 1


def test_the_watch_can_be_turned_off(monkeypatch):
    monkeypatch.setattr(main.settings, "VAULT_WATCH_INTERVAL", 0)
    monkeypatch.setattr(main.md_service_instance, "fingerprint", lambda: (_ for _ in ()).throw(AssertionError("watched")))
    asyncio.run(main._watch_vault())
