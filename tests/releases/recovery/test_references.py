import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

TOOL = Path(__file__).resolve().parents[3]/'scripts/releases/recovery/verify.py'
spec = importlib.util.spec_from_file_location('recovery', TOOL)
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)

class RecoveryReferencesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        self.git('init', '-q')
        self.git('config', 'user.name', 'Fixture')
        self.git('config', 'user.email', 'fixture@example.invalid')
        self.steps = []
        for i in range(35):
            path = f'scripts/sql/fixture/{i:02}.sql'
            data = f'-- immutable synthetic reference {i}; never executed\n'.encode()
            q = self.repo/path; q.parent.mkdir(parents=True, exist_ok=True); q.write_bytes(data)
            self.steps.append({'id':str(i), 'path':path, 'sha256':recovery.sha(data)})
        self.manifest = {'schema_version':1, 'upgrade_steps':self.steps,
                         'fresh_steps':self.steps[10:], 'application_contract_sha256':'a'*64,
                         'baseline_archive':{'snapshot':'synthetic-base', 'sha256':'b'*64},
                         'upgrade_archive':{'snapshot':'synthetic-upgrade', 'sha256':'c'*64}}
        self.old_pin = recovery.MANIFEST_SHA256
        self.addCleanup(setattr, recovery, 'MANIFEST_SHA256', self.old_pin)
        self.save()
        self.commit()

    def git(self, *args):
        return subprocess.run(['git', '-C', str(self.repo), *args], check=True, capture_output=True)

    def save(self):
        q = self.repo/recovery.MANIFEST; q.parent.mkdir(parents=True, exist_ok=True)
        q.write_text(json.dumps(self.manifest)); recovery.MANIFEST_SHA256 = recovery.sha(q.read_bytes())

    def commit(self):
        self.git('add', '--', 'scripts'); self.git('commit', '-qm', 'synthetic reference state')

    def test_complete_git_graph_without_external_archive_or_execution(self):
        result = recovery.verify(self.repo)
        self.assertEqual(result['unique_sql_references'], 35)
        self.assertFalse(result['sql_executed'])
        self.assertEqual(result['fresh_restore'], 'NOT VERIFIED by this source-only check')

    def test_untracked_file_never_fills_a_missing_git_dependency(self):
        path = self.steps[0]['path']
        self.git('rm', '--cached', '--', path); self.git('commit', '-qm', 'missing committed reference')
        self.assertTrue((self.repo/path).exists())
        with self.assertRaises(recovery.InvalidReferences): recovery.verify(self.repo)

    def test_changed_sql_bytes_fail_hash_check(self):
        (self.repo/self.steps[0]['path']).write_text('changed')
        self.commit()
        with self.assertRaises(recovery.InvalidReferences): recovery.verify(self.repo)

    def test_symlink_reference_rejected(self):
        q = self.repo/self.steps[0]['path']; q.unlink(); q.symlink_to('01.sql')
        self.commit()
        with self.assertRaises(recovery.InvalidReferences): recovery.verify(self.repo)

    def test_path_traversal_rejected_even_with_updated_pin(self):
        self.steps[0]['path'] = 'scripts/sql/../../outside.sql'
        self.save(); self.commit()
        with self.assertRaises(recovery.InvalidReferences): recovery.verify(self.repo)

    def test_manifest_change_without_reviewed_pin_rejected(self):
        q = self.repo/recovery.MANIFEST; q.write_text(q.read_text()+'\n')
        self.commit()
        with self.assertRaises(recovery.InvalidReferences): recovery.verify(self.repo)

    def test_duplicate_step_identity_rejected(self):
        self.steps[1]['id'] = self.steps[0]['id']
        self.save(); self.commit()
        with self.assertRaises(recovery.InvalidReferences): recovery.verify(self.repo)

    def test_conflicting_shared_reference_rejected(self):
        self.manifest['fresh_steps'] = [dict(self.steps[0], sha256='d'*64)]
        self.save(); self.commit()
        with self.assertRaises(recovery.InvalidReferences): recovery.verify(self.repo)

if __name__ == '__main__':
    unittest.main()
