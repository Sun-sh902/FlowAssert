"""Generate strict transport types from the frozen schemas; runtime schema remains authoritative."""
import json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
schemas=json.loads((root/'contracts/openapi-v1-proposed.yaml').read_text())['components']['schemas']

def typ(s):
    if '$ref' in s:return s['$ref'].split('/')[-1]
    if 'const' in s:return 'Literal['+repr(s['const'])+']'
    if 'enum' in s:return 'Literal['+', '.join(repr(v) for v in s['enum'])+']'
    t=s.get('type')
    if isinstance(t,list):return 'Union['+', '.join(typ({**s,'type':v}) for v in t)+']'
    if t=='array':return 'list['+typ(s['items'])+']'
    if t=='object':return 'dict[str, '+(typ(s['additionalProperties']) if isinstance(s.get('additionalProperties'),dict) else 'JsonValue')+']'
    return {'string':'str','integer':'int','number':'float','boolean':'bool','null':'None'}.get(t,'JsonValue')

lines=['# Generated from frozen OpenAPI; regenerate with scripts/generate_models.py.','from __future__ import annotations','from typing import Literal, Union','from pydantic import BaseModel, ConfigDict, JsonValue','']
objects={k:v for k,v in schemas.items() if v.get('type')=='object' and 'properties' in v}
for k,v in schemas.items():
    if k not in objects:lines.append(k+' = '+typ(v))
for k,s in objects.items():
    lines.extend(['','class '+k+'(BaseModel):',"    model_config = ConfigDict(strict=True, extra='forbid')"])
    for name,prop in s['properties'].items():
        lines.append('    '+name+': '+typ(prop)+('' if name in s.get('required',[]) else ' = None'))
lines.extend(['',*['%s.model_rebuild()'%k for k in objects]])
(root/'app/models.py').write_text('\n'.join(lines)+'\n')
