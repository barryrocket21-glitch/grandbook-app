#!/usr/bin/env python3
"""Verify committed historical recovery references. No SQL execution or network."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess

MANIFEST = 'scripts/migrations/pnl-ui-2026-10-21.json'
MANIFEST_SHA256 = '0bfa06384836342373debf5e905378843707c8a653344ee8c9d1113c3425cb66'

class InvalidReferences(ValueError):
    pass

def require(ok, message):
    if not ok:
        raise InvalidReferences(message)

def git(repo, *args):
    p = subprocess.run(['git', '-C', str(repo), *args], capture_output=True)
    require(p.returncode == 0, 'Required committed Git input unavailable.')
    return p.stdout

def unique(pairs):
    out = {}
    for key, value in pairs:
        require(key not in out, 'Duplicate manifest key.')
        out[key] = value
    return out

def sha(data):
    return hashlib.sha256(data).hexdigest()

def verify(repo, ref='HEAD'):
    commit = git(repo, 'rev-parse', '--verify', '--end-of-options', ref+'^{commit}').decode().strip()
    tree = {}
    for record in git(repo, 'ls-tree', '-rz', commit).split(b'\0'):
        if record:
            info, path = record.split(b'\t', 1)
            tree[path.decode()] = info.split()[0].decode()
    require(tree.get(MANIFEST) == '100644', 'Recovery manifest is missing or nonregular.')
    raw = git(repo, 'show', commit+':'+MANIFEST)
    require(sha(raw) == MANIFEST_SHA256, 'Current recovery manifest differs from reviewed provenance.')
    manifest = json.loads(raw, object_pairs_hook=unique)
    require(manifest.get('schema_version') == 1, 'Unsupported recovery manifest.')
    refs = {}
    for mode in ['upgrade_steps', 'fresh_steps']:
        steps = manifest.get(mode)
        require(isinstance(steps, list) and steps, 'Recovery mode has no explicit steps.')
        ids = set()
        for step in steps:
            path, checksum, identity = step.get('path'), step.get('sha256'), step.get('id')
            require(isinstance(path, str) and '\\' not in path, 'Invalid reference path.')
            posix = PurePosixPath(path)
            require(not posix.is_absolute() and '..' not in posix.parts and str(posix) == path
                    and path.startswith('scripts/sql/') and path.endswith('.sql')
                    and all(ord(c) >= 32 for c in path), 'Unsafe recovery reference path.')
            require(isinstance(identity, str) and identity and identity not in ids, 'Missing/duplicate recovery step.')
            ids.add(identity)
            require(isinstance(checksum, str) and re.fullmatch('[0-9a-f]{64}', checksum), 'Invalid reference hash.')
            require(path not in refs or refs[path] == checksum, 'Conflicting recovery reference hash.')
            refs[path] = checksum
    require(len(refs) == 35, 'Expected 35 reviewed unique current recovery references.')
    for path, checksum in refs.items():
        require(tree.get(path) == '100644', 'Missing/nonregular committed recovery input: '+path)
        require(sha(git(repo, 'show', commit+':'+path)) == checksum, 'Recovery reference bytes differ: '+path)
    for key in ['baseline_archive', 'upgrade_archive']:
        archive = manifest.get(key, {})
        require(isinstance(archive.get('snapshot'), str) and bool(archive['snapshot'])
                and re.fullmatch('[0-9a-f]{64}', archive.get('sha256', '')), 'Invalid private archive reference.')
    return {
        'status': 'RECOVERY_REFERENCES_VERIFIED',
        'commit': commit,
        'unique_sql_references': len(refs),
        'upgrade_steps': len(manifest['upgrade_steps']),
        'fresh_steps': len(manifest['fresh_steps']),
        'manifest_sha256': sha(raw),
        'application_contract_sha256': manifest['application_contract_sha256'],
        'sql_executed': False,
        'private_archives': 'external; not read or exported',
        'fresh_restore': 'NOT VERIFIED by this source-only check',
    }

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[3])
    parser.add_argument('--ref', default='HEAD')
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args.repo, args.ref), indent=2))
    except (InvalidReferences, ValueError, KeyError, TypeError) as error:
        parser.exit(1, str(error)+'\n')
