"""Read-only protected-source inventory. All output/copies stay in this workspace."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / 'docs/phase3a/evidence'
NAMES = ['FlowAssert-Service', 'FlowAssert-UI', 'FlowAssert-Service-Review',
         'FlowAssert-UI-Review', 'FlowAssert-Phase2-Support', 'FlowAssert-Phase2-Review',
         'FlowAssert-round03-oracle-fix', 'FlowAssert-Integration-Planning',
         'FlowAssert-Integration-Review', 'FlowAssert-Integration-Reassessment',
         'FlowAssert-Integration-Final-Audit']

def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1048576), b''): h.update(block)
    return h.hexdigest()

def git(path, args):
    p = subprocess.run(['git', '--no-optional-locks', '-c', 'core.fsmonitor=false',
                        '-C', str(path), *args], capture_output=True, text=True,
                       env={**os.environ, 'LC_ALL': 'C', 'GIT_OPTIONAL_LOCKS': '0'})
    return {'exit': p.returncode, 'stdout': p.stdout, 'stderr': p.stderr}

def walk(path):
    out = {}
    def entry(p):
        s = p.lstat()
        v = {'mode': stat.S_IMODE(s.st_mode), 'uid': s.st_uid, 'gid': s.st_gid,
             'mtime_ns': s.st_mtime_ns, 'size': s.st_size, 'nlink': s.st_nlink}
        if p.is_symlink(): v.update(type='symlink', target=os.readlink(p))
        elif stat.S_ISREG(s.st_mode):
            secret = p.suffix == '.key' or '.state' in p.parts
            v.update(type='file', sha256='SECRET_CONTENT_NOT_CAPTURED' if secret else sha(p))
        elif p.is_dir(): v.update(type='directory')
        else: v.update(type='special')
        out[str(p.relative_to(path))] = v
    entry(path)
    for base, dirs, files in os.walk(path, followlinks=False):
        for name in sorted(dirs + files): entry(Path(base) / name)
    return out

def snapshot():
    out = {}
    for name in NAMES:
        p = ROOT.parent / name
        commands = {'head': ['rev-parse', 'HEAD'], 'branch': ['symbolic-ref', 'HEAD'],
                    'status': ['status', '--porcelain=v1', '--untracked-files=all'],
                    'ignored': ['ls-files', '--others', '--ignored', '--exclude-standard'],
                    'index': ['ls-files', '--stage'], 'gitdir': ['rev-parse', '--absolute-git-dir'],
                    'common': ['rev-parse', '--path-format=absolute', '--git-common-dir']}
        g = {k: git(p, a) for k, a in commands.items()}
        item = {'files': walk(p), 'git': g}
        for k in ('gitdir', 'common'):
            if g[k]['exit'] == 0:
                gp = Path(g[k]['stdout'].strip())
                if not gp.is_relative_to(p): item[k + '_external_files'] = walk(gp)
        out[name] = item
    return out

def main():
    DOCS.mkdir(parents=True, exist_ok=True)
    stage = sys.argv[1]
    target = DOCS / f'protected-{stage}.json'
    if target.exists(): raise SystemExit('Refusing to replace existing observation')
    result = snapshot()
    target.write_text(json.dumps(result, indent=2, sort_keys=True))
    if stage == 'before':
        accepted = json.loads((ROOT.parent / 'FlowAssert-Phase2-Support/evidence/identity/accepted-source-comparison.json').read_text())
        source = ROOT.parent / 'FlowAssert-Service'
        source_files = sorted(str(p.relative_to(source)) for p in source.rglob('*')
                              if p.is_file() and not any(x in p.relative_to(source).parts
                              for x in ('.venv', '.state', 'evidence', '__pycache__', '.pytest_cache', '.git')))
        expected = accepted['files']
        manifest = {p: sha(source / p) for p in source_files}
        drift = {p: {'actual': manifest.get(p), 'accepted': expected.get(p, {}).get('accepted')}
                 for p in set(manifest) | set(expected)
                 if manifest.get(p) != expected.get(p, {}).get('accepted')}
        (DOCS / 'baseline-source.json').write_text(json.dumps({'files': manifest, 'drift': drift,
              'reference_sha256': sha(ROOT.parent / 'FlowAssert-Phase2-Support/evidence/identity/accepted-source-comparison.json')}, indent=2))
        if drift: raise SystemExit('STOP: unexplained source drift')
        for dest in (ROOT / 'baseline/FlowAssert-Service', ROOT):
            for rel in source_files:
                dst = dest / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                if dst.exists(): raise SystemExit(f'Refusing overwrite: {dst}')
                shutil.copy2(source / rel, dst)
                assert sha(dst) == manifest[rel]
        model = ROOT.parent / 'FlowAssert-round03-oracle-fix/experiments/round03/model.py'
        for dst in (ROOT / 'vendor/model.py', ROOT / 'baseline/FlowAssert-round03-oracle-fix/experiments/round03/model.py'):
            dst.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(model, dst)
        shutil.copytree(source / '.venv', ROOT / '.venv', symlinks=True,
                        ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
        shutil.copy2(ROOT.parent / 'FlowAssert-Phase2-Support/ACCEPTED_SOURCE_IDENTITY.md', DOCS / 'accepted-identity-reference.md')
        print(f'Baseline: {len(manifest)} source files; 0 drift; isolated copies match. Protected objects: '
              f'{sum(len(x["files"]) for x in result.values())}')
    else:
        before = json.loads((DOCS / 'protected-before.json').read_text())
        differences = {}
        for name in NAMES:
            a, b = before[name], result[name]
            changes = [p for p in sorted(set(a['files']) | set(b['files'])) if a['files'].get(p) != b['files'].get(p)]
            differences[name] = {'changed_objects': changes, 'git_equal': a['git'] == b['git'],
                                'external_git_equal': all(a.get(k) == b.get(k) for k in ('gitdir_external_files', 'common_external_files'))}
        (DOCS / f'protected-comparison-{stage}.json').write_text(json.dumps(differences, indent=2))
        print(json.dumps({n: {**v, 'changed_objects': len(v['changed_objects'])} for n, v in differences.items()}, indent=2))
        if any(v['changed_objects'] or not v['git_equal'] or not v['external_git_equal'] for v in differences.values()): sys.exit(1)

if __name__ == '__main__': main()
