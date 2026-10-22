#!/usr/bin/env python3
"""Prepare a reviewed application from immutable Git blobs. Never pushes/deploys."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys

MANIFEST = 'scripts/releases/repo-readiness/manifest.json'
TEMPLATE = 'scripts/releases/repo-readiness/next-env.d.ts.template'
ROOT_FILES = {'.vercelignore', 'package.json', 'package-lock.json', 'next.config.ts',
              'next-env.d.ts', 'postcss.config.mjs', 'components.json', 'tsconfig.json'}

class InvalidRelease(ValueError):
    pass

def require(ok, message):
    if not ok:
        raise InvalidRelease(message)

def git(repo, *args, data=None):
    p = subprocess.run(['git', '-C', str(repo), *args], input=data, capture_output=True)
    require(p.returncode == 0, 'Git input is unavailable; commit the reviewed files first.')
    return p.stdout

def sha(data):
    return hashlib.sha256(data).hexdigest()

def unique(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'Duplicate manifest key.')
        result[key] = value
    return result

def safe_path(value):
    require(isinstance(value, str) and value and '\\' not in value and
            not any(ord(c) < 32 for c in value), 'Invalid manifest path.')
    p = PurePosixPath(value)
    require(not p.is_absolute() and '..' not in p.parts and str(p) == value,
            'Manifest paths must be relative canonical paths.')
    require(not any(s.startswith('.env') or s in {'.git', '.next', 'node_modules'}
                    or '.private.' in s for s in p.parts), 'Private/build input is forbidden.')
    return value

def sensitive(data):
    return re.search(rb'-----BEGIN [A-Z ]*PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{12,}|\bsbp_[A-Za-z0-9]{20,}|\bsb_secret_[A-Za-z0-9_-]{20,}', data) is not None

def blobs(repo, commit, paths):
    queries = [commit + ':' + p for p in paths]
    raw = git(repo, 'cat-file', '--batch', data=('\n'.join(queries)+'\n').encode())
    offset, result = 0, {}
    for path in paths:
        end = raw.find(b'\n', offset)
        require(end >= offset, 'Incomplete Git object stream.')
        header = raw[offset:end].split()
        require(len(header) == 3 and header[1] == b'blob', 'Required Git blob missing: '+path)
        size = int(header[2]); start = end+1; data = raw[start:start+size]
        require(len(data) == size and raw[start+size:start+size+1] == b'\n', 'Incomplete Git blob.')
        result[path] = data; offset = start+size+1
    return result

def inputs(repo, ref='HEAD', working=True):
    commit = git(repo, 'rev-parse', '--verify', '--end-of-options', ref+'^{commit}').decode().strip()
    manifest_raw = blobs(repo, commit, [MANIFEST])[MANIFEST]
    spec = json.loads(manifest_raw, object_pairs_hook=unique)
    require(spec.get('schema_version') == 1, 'Unsupported manifest version.')
    files = spec.get('files', {})
    require(len(files) == spec.get('file_count') == 454, 'Expected all 454 reviewed application files.')
    mode = {}
    for record in git(repo, 'ls-tree', '-rz', commit).split(b'\0'):
        if record:
            info, name = record.split(b'\t', 1)
            mode[name.decode()] = info.split()[0].decode()
    sources = {}
    for destination, item in files.items():
        safe_path(destination)
        require(destination.startswith(('src/', 'public/')) or destination in ROOT_FILES,
                'Destination is outside the reviewed application.')
        source = safe_path(item.get('source', destination))
        require(source == destination or (destination == 'next-env.d.ts' and source == TEMPLATE),
                'Unexpected source mapping.')
        require(re.fullmatch('[0-9a-f]{64}', item.get('sha256', '')) is not None, 'Invalid input hash.')
        require(mode.get(source) in {'100644', '100755'}, 'Missing/nonregular Git input: '+source)
        sources[destination] = source
    content = blobs(repo, commit, list(dict.fromkeys(sources.values())))
    payload = {}
    for destination, source in sources.items():
        data = content[source]
        require(sha(data) == files[destination]['sha256'], 'Reviewed Git hash differs: '+destination)
        require(not sensitive(data), 'Potential credential in reviewed source: '+destination)
        if working:
            q = repo/source
            require(q.is_file() and not q.is_symlink() and q.read_bytes() == data,
                    'Uncommitted/missing reviewed input: '+source)
        payload[destination] = data
    if working:
        require((repo/MANIFEST).read_bytes() == manifest_raw, 'Manifest has uncommitted edits.')
        extras = set(spec.get('permitted_extra_source_files', []))
        require(all(safe_path(n).startswith('src/') and n.endswith('.sql') for n in extras),
                'Only named historical SQL may remain outside the release.')
        for base in ['src', 'public']:
            for q in (repo/base).rglob('*'):
                if q.is_file() or q.is_symlink():
                    n = str(q.relative_to(repo))
                    require(n in payload or n in extras, 'Unreviewed application source outside manifest: '+n)
    digest = sha(json.dumps({n:sha(data) for n,data in sorted(payload.items())}, separators=(',', ':')).encode())
    return commit, payload, digest

def verify_package(folder, payload):
    require(folder.is_dir(), 'Package directory is missing.')
    actual = set()
    for q in folder.rglob('*'):
        require(not q.is_symlink(), 'Package contains a symlink.')
        if q.is_file():
            actual.add(str(q.relative_to(folder)))
    require(actual == set(payload), 'Package file list differs from the 454 reviewed inputs.')
    for n, data in payload.items():
        require(sha((folder/n).read_bytes()) == sha(data), 'Package content differs: '+n)

def prepare(repo, ref, output):
    commit, payload, digest = inputs(repo, ref)
    sidecar = output.with_name(output.name+'.readiness.json')
    require(not output.exists() and not sidecar.exists(), 'Output/sidecar already exists; nothing overwritten.')
    output.mkdir(parents=True, exist_ok=False)
    for n, data in payload.items():
        q = output/n; q.parent.mkdir(parents=True, exist_ok=True); q.write_bytes(data)
    verify_package(output, payload)
    record = {'status':'PREPARED_NOT_DEPLOYED', 'commit':commit, 'files':len(payload),
              'input_sha256':digest, 'package':str(output)}
    with sidecar.open('x') as f:
        json.dump(record, f, indent=2)
    return record

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[3])
    sub = parser.add_subparsers(dest='command', required=True)
    for name in ['check', 'prepare', 'verify']:
        s = sub.add_parser(name); s.add_argument('--ref', default='HEAD')
        if name == 'prepare': s.add_argument('--output', type=Path, required=True)
        if name == 'verify': s.add_argument('--package', type=Path, required=True)
    a = parser.parse_args()
    if a.command == 'prepare':
        result = prepare(a.repo, a.ref, a.output)
    else:
        commit, payload, digest = inputs(a.repo, a.ref, working=a.command == 'check')
        if a.command == 'verify': verify_package(a.package, payload)
        result = {'status':'SOURCE_READY' if a.command == 'check' else 'PACKAGE_VERIFIED',
                  'commit':commit, 'files':len(payload), 'input_sha256':digest}
    print(json.dumps(result, indent=2))

if __name__ == '__main__':
    try:
        main()
    except (InvalidRelease, ValueError, OSError) as e:
        print('NOT READY: '+str(e), file=sys.stderr)
        sys.exit(1)
