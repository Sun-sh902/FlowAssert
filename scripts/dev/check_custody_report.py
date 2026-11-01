"""Require the one historical custody test to have actually passed."""
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


def main(path):
    try:
        root = ET.parse(Path(path)).getroot()
        cases = list(root.iter('testcase'))
        if (len(cases) != 1 or cases[0].get('classname') != 'tests.test_service'
                or cases[0].get('name') != 'test_protected_repository_integrity'
                or any(cases[0].find(tag) is not None for tag in ('skipped', 'failure', 'error'))):
            raise ValueError('expected exactly one successful protected custody test')
    except (OSError, ValueError, ET.ParseError) as exc:
        print(f'protected custody inventory: FAIL ({exc})', file=sys.stderr)
        return 1
    print('protected custody inventory: OK (one test passed)')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1]))
