"""Compare all protected tree file bytes/symlinks and read-only Git observations."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
ROOT=Path(__file__).resolve().parents[1]

def snapshot():
    before=json.loads((ROOT/'evidence/protected-before.json').read_text());out={}
    for name in before:
        path=ROOT.parent/name;files={}
        for base,dirs,names in os.walk(path):
            for name_ in names:
                q=Path(base)/name_
                files[str(q.relative_to(path))]='link:'+os.readlink(q) if q.is_symlink() else hashlib.sha256(q.read_bytes()).hexdigest()
        git={}
        for key,args in [('head',['rev-parse','HEAD']),('branch',['symbolic-ref','HEAD']),('status',['status','--porcelain=v1','--untracked-files=all'])]:
            r=subprocess.run(['git','--no-optional-locks','-c','core.fsmonitor=false','-C',str(path),*args],capture_output=True,text=True)
            git[key]={'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr}
        out[name]={'files':files,'git':git}
    return out

def baseline_path():
    selected = Path(os.environ.get('FLOWASSERT_INTEGRITY_BASELINE', str(ROOT/'evidence/protected-before.json'))).resolve()
    if not selected.is_relative_to((ROOT/'evidence').resolve()):
        raise ValueError('Baseline must be a service-owned evidence file')
    return selected

def compare(after):
    before=json.loads(baseline_path().read_text());diff={}
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
