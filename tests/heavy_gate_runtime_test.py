import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

GATE = os.environ.get(
    'HEAVY_GATE_TEST_GATE',
    str(Path(__file__).resolve().parents[1] / 'bin' / 'heavy-gate'),
)


@unittest.skipUnless(
    sys.platform == 'linux' and os.environ.get('HEAVY_GATE_INTEGRATION') == '1',
    'requires opt-in, user systemd, and the shared gate slots',
)
class GateIsolationTest(unittest.TestCase):
    def test_session_bus_cannot_move_child_out_of_memory_limit(self):
        # Replay Chromium's PIDs-only StartTransientUnit call with a harmless
        # process. No browser or memory pressure is needed to expose the escape.
        probe = r'''
import json
from pathlib import Path
import subprocess
import time


def cgroup(pid):
    return next(line[3:] for line in Path(f'/proc/{pid}/cgroup').read_text().splitlines()
                if line.startswith('0::'))


child = subprocess.Popen(['sleep', '30'], close_fds=True)
try:
    before = cgroup(child.pid)
    attempt = subprocess.run([
        'busctl', '--user', 'call', 'org.freedesktop.systemd1',
        '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager',
        'StartTransientUnit', 'ssa(sv)a(sa(sv))',
        f'app-heavyGateProbe-{child.pid}.scope', 'replace',
        '1', 'PIDs', 'au', '1', str(child.pid), '0',
    ], text=True, capture_output=True, timeout=5)
    if attempt.returncode == 0:
        for _ in range(100):
            if cgroup(child.pid) != before:
                break
            time.sleep(0.02)
    after = cgroup(child.pid)
    group = Path('/sys/fs/cgroup' + after)
    print(json.dumps({
        'before': before,
        'after': after,
        'migration_status': attempt.returncode,
        'migration_error': attempt.stderr,
        'memory_max': (group / 'memory.max').read_text().strip(),
        'memory_swap_max': (group / 'memory.swap.max').read_text().strip(),
    }))
finally:
    child.terminate()
    child.wait()
'''
        result = subprocess.run(
            [GATE, '-m', '128M', '-l', 'scope-migration-regression', '--', sys.executable, '-c', probe],
            text=True, capture_output=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertNotEqual(report['migration_status'], 0, report)
        self.assertEqual(report['after'], report['before'], report)
        self.assertEqual(report['memory_max'], str(128 * 1024 * 1024), report)
        self.assertEqual(report['memory_swap_max'], '0', report)


if __name__ == '__main__':
    unittest.main()
