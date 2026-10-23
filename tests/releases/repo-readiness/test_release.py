import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

TOOL = Path(__file__).resolve().parents[3]/'scripts/releases/repo-readiness/release.py'
spec = importlib.util.spec_from_file_location('release', TOOL)
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)

class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name); self.repo = self.base/'repo'; self.repo.mkdir()
        self.run_git('init', '-q')
        self.run_git('config', 'user.name', 'Fixture')
        self.run_git('config', 'user.email', 'fixture@example.invalid')
        files = {}
        for i in range(455):
            name = f'src/fixture-{i:03}.ts'; q = self.repo/name; q.parent.mkdir(exist_ok=True)
            q.write_text(f'export const value = {i}\n'); files[name] = {'sha256':release.sha(q.read_bytes())}
        q = self.repo/'.vercelignore'; q.write_text('.env*\ntests\n')
        files['.vercelignore'] = {'sha256':release.sha(q.read_bytes())}
        q = self.repo/release.TEMPLATE; q.parent.mkdir(parents=True, exist_ok=True); q.write_text('/// <reference types="next" />\n')
        files['next-env.d.ts'] = {'source':release.TEMPLATE, 'sha256':release.sha(q.read_bytes())}
        self.manifest = {'schema_version':1, 'file_count':457, 'files':files, 'permitted_extra_source_files':[]}
        self.write_manifest(); self.run_git('add', '--', 'src', '.vercelignore', 'scripts')
        self.run_git('commit', '-qm', 'synthetic reviewed input')

    def run_git(self, *args):
        subprocess.run(['git', '-C', str(self.repo), *args], check=True, capture_output=True)

    def write_manifest(self):
        (self.repo/release.MANIFEST).write_text(json.dumps(self.manifest))

    def commit_manifest(self):
        self.write_manifest(); self.run_git('add', '--', release.MANIFEST)
        self.run_git('commit', '-qm', 'synthetic manifest update')

    def test_prepare_reconstructs_git_and_ignores_private_material(self):
        (self.repo/'.env.local').write_text('PRIVATE_FIXTURE=must-not-export\n')
        (self.repo/'operator.xlsx').write_bytes(b'private synthetic fixture')
        out = self.base/'package'; report = release.prepare(self.repo, 'HEAD', out)
        self.assertEqual(report['files'], 457); self.assertEqual(report['status'], 'PREPARED_NOT_DEPLOYED')
        self.assertFalse((out/'.env.local').exists()); self.assertFalse((out/'operator.xlsx').exists())
        self.assertTrue((out/'next-env.d.ts').is_file())
        _, payload, _ = release.inputs(self.repo); release.verify_package(out, payload)

    def test_dirty_reviewed_source_is_rejected_and_preserved(self):
        q = self.repo/'src/fixture-000.ts'; q.write_text('new operator work')
        with self.assertRaises(release.InvalidRelease): release.prepare(self.repo, 'HEAD', self.base/'output')
        self.assertEqual(q.read_text(), 'new operator work'); self.assertFalse((self.base/'output').exists())

    def test_unreviewed_application_file_is_rejected(self):
        (self.repo/'src/new-route.ts').write_text('export default 1')
        with self.assertRaises(release.InvalidRelease): release.inputs(self.repo)

    def test_symlink_git_input_is_rejected(self):
        q = self.repo/'src/fixture-000.ts'; q.unlink(); q.symlink_to('../.env.local')
        self.run_git('add', '--', str(q.relative_to(self.repo))); self.run_git('commit', '-qm', 'synthetic symlink')
        with self.assertRaises(release.InvalidRelease): release.inputs(self.repo)

    def test_traversal_manifest_destination_is_rejected(self):
        self.manifest['files']['../escape.ts'] = self.manifest['files'].pop('src/fixture-000.ts')
        self.commit_manifest()
        with self.assertRaises(release.InvalidRelease): release.inputs(self.repo)

    def test_false_input_hash_is_rejected(self):
        self.manifest['files']['src/fixture-000.ts']['sha256'] = '0'*64; self.commit_manifest()
        with self.assertRaises(release.InvalidRelease): release.inputs(self.repo)

    def test_existing_output_is_never_overwritten(self):
        out = self.base/'existing'; out.mkdir(); (out/'sentinel').write_text('keep')
        with self.assertRaises(release.InvalidRelease): release.prepare(self.repo, 'HEAD', out)
        self.assertEqual((out/'sentinel').read_text(), 'keep')

    def test_changed_package_is_rejected(self):
        out = self.base/'package'; release.prepare(self.repo, 'HEAD', out)
        (out/'src/fixture-000.ts').write_text('changed')
        with self.assertRaises(release.InvalidRelease): release.verify_package(out, release.inputs(self.repo)[1])

    def test_extra_package_file_is_rejected(self):
        out = self.base/'package'; release.prepare(self.repo, 'HEAD', out)
        (out/'.env.local').write_text('synthetic private material')
        with self.assertRaises(release.InvalidRelease): release.verify_package(out, release.inputs(self.repo)[1])

    def test_missing_git_input_cannot_fall_back_to_working_tree(self):
        self.run_git('rm', '-q', '--cached', 'src/fixture-000.ts'); self.run_git('commit', '-qm', 'synthetic missing source')
        self.assertTrue((self.repo/'src/fixture-000.ts').exists())
        with self.assertRaises(release.InvalidRelease): release.inputs(self.repo)

    def test_duplicate_manifest_keys_are_rejected(self):
        q = self.repo/release.MANIFEST
        q.write_text(q.read_text().replace('"schema_version": 1', '"schema_version": 1, "schema_version": 1', 1))
        self.run_git('add', '--', release.MANIFEST); self.run_git('commit', '-qm', 'synthetic duplicate key')
        with self.assertRaises(release.InvalidRelease): release.inputs(self.repo)

    def test_potential_credential_is_rejected_before_output(self):
        data = ('eyJ'+'a'*30+'.'+'b'*30+'.'+'c'*30).encode()
        q = self.repo/'src/fixture-000.ts'; q.write_bytes(data)
        self.manifest['files']['src/fixture-000.ts']['sha256'] = release.sha(data)
        self.write_manifest(); self.run_git('add', '--', 'src/fixture-000.ts', release.MANIFEST)
        self.run_git('commit', '-qm', 'synthetic sensitive pattern')
        with self.assertRaises(release.InvalidRelease): release.prepare(self.repo, 'HEAD', self.base/'output')
        self.assertFalse((self.base/'output').exists())


class UploadIgnoreTests(unittest.TestCase):
    def check_paths(self, paths):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            subprocess.run(['git', 'init', '-q', str(root)], check=True, capture_output=True)
            (root/'.gitignore').write_bytes((TOOL.parents[3]/'.vercelignore').read_bytes())
            p = subprocess.run(['git', '-C', str(root), 'check-ignore', '--no-index', '--stdin', '-z'],
                               input=('\0'.join(paths)+'\0').encode(), capture_output=True)
            self.assertIn(p.returncode, [0, 1], p.stderr.decode())
            return set(p.stdout.decode().strip('\0').split('\0')) - {''}

    def test_every_reviewed_source_survives_upload_exclusions(self):
        manifest = json.loads((TOOL.parent/'manifest.json').read_text())
        self.assertEqual(self.check_paths(list(manifest['files'])), set())

    def test_private_operator_material_still_excluded(self):
        paths = ['.env.local', 'supabase/.temp/pooler-url',
                 'docs/customer-export.xlsx', 'tests/auth/owner-session.json',
                 'foto sementara/orders.xlsx', 'src/lib/audit.private.json',
                 '.vercel/project.json', 'vercel.json']
        self.assertEqual(self.check_paths(paths), set(paths))

if __name__ == '__main__':
    unittest.main()
