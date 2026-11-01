"""A changed implementation creates a distinct, honestly attributed seed set."""
import hashlib

from app import history_store
from app.history_store import ArchiveStore
from app.identity import digest
from archive_cli import configure_ephemeral_key


def test_seed_after_implementation_change_creates_and_reuses_new_source_set(tmp_path, monkeypatch):
    state = tmp_path / 'state'
    configure_ephemeral_key(state)
    store = ArchiveStore(state)
    first = store.seed()
    original_source, original_identity = history_store.source_identity()
    assert first['source_set_sha256'] == original_identity
    assert first['evaluations'] == 5

    # Model an implementation upgrade without modifying source files or the
    # real preserved archives.  All other reviewed inputs stay unchanged.
    upgraded_source = {
        **original_source,
        'implementation': hashlib.sha256(b'new reviewed implementation').hexdigest(),
    }
    upgraded_identity = digest(upgraded_source)
    assert upgraded_identity != original_identity
    monkeypatch.setattr(history_store, 'source_identity', lambda: (upgraded_source, upgraded_identity))
    # A new process snapshots its source set on import; emulate that restart.
    monkeypatch.setattr(history_store, '_LOADED_SOURCE_IDENTITY', (upgraded_source, upgraded_identity))

    upgraded = store.seed()
    assert upgraded['source_set_sha256'] == upgraded_identity
    assert not upgraded['reused'] and upgraded['evaluations'] == 5
    assert set(first['history_ids']).isdisjoint(upgraded['history_ids'])
    repeated = store.seed()
    assert repeated['reused'] and repeated['evaluations'] == 0
    assert repeated['history_ids'] == upgraded['history_ids']
    assert store.listing(limit=100)['page']['total'] == 10

    with store.connection() as connection:
        for ids, expected in [(first['history_ids'], original_identity),
                              (upgraded['history_ids'], upgraded_identity)]:
            for history_id in ids:
                candidate, _ = store._read(connection, history_id)
                assert candidate['provenance']['source_set_sha256'] == expected
