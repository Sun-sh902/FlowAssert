"""Controlled local writer. No arbitrary input/file/evidence import capability."""
import argparse
import json
import os
import secrets
import sys
sys.dont_write_bytecode = True
from app.history_security import HistoryError, state_directory, private_file
from app.history_store import ArchiveStore, DEFAULT_STATE
from app.identity import ServiceError


def configure_ephemeral_key(state):
    directory = state_directory(state, create=True)
    path = directory / 'ephemeral-cursor.key'
    _, data = private_file(path, create=True, content=secrets.token_hex(32).encode())
    if len(data) != 64 or any(x not in b'0123456789abcdef' for x in data):
        raise HistoryError(503, 'cursor_key_unavailable')
    os.environ['FLOWASSERT_CURSOR_KEY_FILE'] = str(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', default=str(DEFAULT_STATE))
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('init')
    seed = commands.add_parser('seed'); seed.add_argument('--reevaluate', action='store_true')
    commands.add_parser('check')
    args = parser.parse_args()
    store = ArchiveStore(args.state)
    try:
        if args.command == 'init': store.initialize(); result = {'schema_version': 1, 'initialized': True}
        elif args.command == 'seed':
            configure_ephemeral_key(args.state)
            result = store.seed(reevaluate=args.reevaluate)
        else:
            page = store.listing(limit=100); count = len(page['items'])
            while page['page']['next_cursor']:
                page = store.listing(limit=100, cursor=page['page']['next_cursor']); count += len(page['items'])
            result = {'validated_archives': count, 'schema_version': 1, 'integrity': 'INTEGRITY_VERIFIED'}
        print(json.dumps(result, indent=2))
        return 0
    except ServiceError as e:
        print(json.dumps({'error': {'code': e.code, 'status': e.status}}), file=sys.stderr)
        return 1

if __name__ == '__main__': sys.exit(main())
