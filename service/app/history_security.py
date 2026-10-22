"""Private local state and strict, persistent, scope-bound history cursors."""
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import stat
from .identity import ROOT, ServiceError, canonical


class HistoryError(ServiceError):
    def __init__(self, status, code, integrity=None):
        super().__init__(status, code)
        self.integrity = integrity


def fail(code, integrity='INTEGRITY_UNVERIFIABLE'):
    raise HistoryError(503, code, integrity)


def state_directory(path, create=False):
    """Reject symlinks in every component; private state is confined to this checkout."""
    path = Path(os.path.abspath(path))
    if not path.is_relative_to(ROOT) or path == ROOT:
        fail('unsafe_state_path')
    # Resolve no links, including ancestors above the private state boundary.
    for parent in reversed((ROOT, *ROOT.parents)):
        if parent.is_symlink(): fail('unsafe_state_path')
    current = ROOT
    for part in path.relative_to(ROOT).parts:
        current /= part
        if create:
            try: current.mkdir(mode=0o700)
            except FileExistsError: pass
        try: s = current.lstat()
        except OSError: fail('archive_unavailable')
        if not stat.S_ISDIR(s.st_mode) or s.st_uid != os.getuid() or s.st_mode & 0o077:
            fail('unsafe_state_path')
    return path


def private_file(path, create=False, content=None):
    try:
        if create:
            try:
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                with os.fdopen(fd, 'wb') as f:
                    if content is not None: f.write(content)
                    f.flush(); os.fsync(f.fileno())
                d = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                try: os.fsync(d)
                finally: os.close(d)
            except FileExistsError: pass
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            s = os.fstat(fd)
            if not stat.S_ISREG(s.st_mode) or s.st_uid != os.getuid() or s.st_mode & 0o077 or s.st_nlink != 1:
                fail('unsafe_state_file')
            data = os.read(fd, 1048577) if content is not None else None
        finally: os.close(fd)
        return s, data
    except OSError: fail('archive_unavailable')


def signing_key(directory, create=False):
    _, data = private_file(directory / 'history-hmac.key', create, secrets.token_bytes(32))
    if data is None or len(data) != 32: fail('history_key_unavailable')
    return data


class Cursors:
    def __init__(self, key): self.key = key

    def encode(self, value):
        raw = canonical(value)
        return base64.urlsafe_b64encode(raw).decode().rstrip('=') + '.' + hmac.new(self.key, raw, hashlib.sha256).hexdigest()

    def decode(self, value):
        try:
            if not isinstance(value, str) or not 1 <= len(value) <= 2048: raise ValueError()
            encoded, sig = value.split('.')
            if not re.fullmatch('[A-Za-z0-9_-]+', encoded) or not re.fullmatch('[a-f0-9]{64}', sig): raise ValueError()
            raw = base64.b64decode(encoded + '=' * (-len(encoded) % 4), altchars=b'-_', validate=True)
            if base64.urlsafe_b64encode(raw).decode().rstrip('=') != encoded: raise ValueError()
            if not hmac.compare_digest(sig, hmac.new(self.key, raw, hashlib.sha256).hexdigest()): raise ValueError()
            data = json.loads(raw)
            if canonical(data) != raw or not isinstance(data, dict): raise ValueError()
            return data
        except (ValueError, TypeError, UnicodeError):
            raise HistoryError(400, 'invalid_cursor') from None


def history_id(value):
    if not re.fullmatch('hist_[a-f0-9]{64}', value):
        raise HistoryError(422, 'invalid_history_id')
    return value
