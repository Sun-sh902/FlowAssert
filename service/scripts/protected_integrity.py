"""Compare all protected tree file bytes/symlinks and read-only Git observations."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
ROOT=Path(__file__).resolve().parents[1]
# Product workspace (round 02): the protected roots are named relative to an EXPLICIT parent directory instead of
# only this checkout's parent, so the comparison runs from a copied workspace. Default unchanged: ROOT.parent.
PROTECTED_PARENT=Path(os.environ.get('FLOWASSERT_PROTECTED_PARENT', str(ROOT.parent))).resolve()
# The accepted baseline recorded by the Phase 3A Service (FlowAssert-Phase3A-Service/evidence/protected-before.json).
BASELINE_SHA256='a12bc4b24d4e2a4242a3e711bd9c1279105d8e108091ae2333c4d177a4541903'
# Git messages are compared byte for byte; the baseline was recorded under the C locale.
GIT_ENV={**os.environ,'LC_ALL':'C','LANG':'C'}

def _verified_baseline_bytes(path):
    data=path.read_bytes()
    if path==(ROOT/'evidence/protected-before.json').resolve() and hashlib.sha256(data).hexdigest()!=BASELINE_SHA256:
        raise ValueError('protected-before.json does not match the accepted baseline digest')
    return data

def snapshot():
    before=json.loads(_verified_baseline_bytes((ROOT/'evidence/protected-before.json').resolve()));out={}
    for name in before:
        path=PROTECTED_PARENT/name;files={}
        # A missing root must not be compared as an empty tree: os.walk would yield nothing and hide the absence.
        if not path.is_dir():
            raise FileNotFoundError(f'protected root {path} is missing; set FLOWASSERT_PROTECTED_PARENT to the directory that holds it')
        for base,dirs,names in os.walk(path):
            for name_ in names:
                q=Path(base)/name_
                files[str(q.relative_to(path))]='link:'+os.readlink(q) if q.is_symlink() else hashlib.sha256(q.read_bytes()).hexdigest()
        git={}
        for key,args in [('head',['rev-parse','HEAD']),('branch',['symbolic-ref','HEAD']),('status',['status','--porcelain=v1','--untracked-files=all'])]:
            r=subprocess.run(['git','--no-optional-locks','-c','core.fsmonitor=false','-C',str(path),*args],capture_output=True,text=True,env=GIT_ENV)
            git[key]={'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr}
        out[name]={'files':files,'git':git}
    return out

def baseline_path():
    selected = Path(os.environ.get('FLOWASSERT_INTEGRITY_BASELINE', str(ROOT/'evidence/protected-before.json'))).resolve()
    if not selected.is_relative_to((ROOT/'evidence').resolve()):
        raise ValueError('Baseline must be a service-owned evidence file')
    return selected

def compare(after):
    before=json.loads(_verified_baseline_bytes(baseline_path()));diff={}
    for name,prior in before.items():
        now=after[name]
        diff[name]={'file_differences':[k for k in sorted(set(prior['files'])|set(now['files'])) if prior['files'].get(k)!=now['files'].get(k)],'git_equal':prior['git']==now['git'],'file_count':len(now['files'])}
    return diff

if __name__=='__main__':
    output=Path(os.environ.get('FLOWASSERT_EVIDENCE_DIR', str(ROOT/'evidence'))).resolve()
    if not output.is_relative_to((ROOT/'evidence').resolve()): raise ValueError('Invalid evidence directory')
    if any((output/name).exists() for name in ['protected-after.json','protected-comparison.json']):
        raise FileExistsError('Refusing to overwrite prior integrity observations; select a new evidence directory')
    output.mkdir(parents=True,exist_ok=True)
    after=snapshot();diff=compare(after)
    (output/'protected-after.json').write_text(json.dumps(after,indent=2))
    (output/'protected-comparison.json').write_text(json.dumps(diff,indent=2))
    print(json.dumps(diff,indent=2))
    raise SystemExit(0 if all(not d['file_differences'] and d['git_equal'] for d in diff.values()) else 1)
