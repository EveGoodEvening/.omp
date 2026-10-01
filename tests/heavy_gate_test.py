import json
from pathlib import Path
import subprocess
import tempfile
import unittest

HOOK = Path(__file__).resolve().parents[1] / 'bin' / 'heavy-gate-hook'
GATE = str(Path.home() / '.omp' / 'bin' / 'heavy-gate')


class LaunchPolicyTest(unittest.TestCase):
    def check(self, command=None, *, code=None, language='js', cwd=None):
        payload = {
            'toolName': 'bash' if command is not None else 'eval',
            'input': {'command': command} if command is not None else {'code': code, 'language': language},
            'cwd': str(cwd or Path.cwd()),
        }
        result = subprocess.run([str(HOOK)], input=json.dumps(payload), text=True, capture_output=True, check=True)
        return json.loads(result.stdout)

    def test_gate_only_covers_its_own_simple_command(self):
        self.assertFalse(self.check(f'{GATE} -- npx playwright test')['block'])
        self.assertTrue(self.check(f'{GATE} -- true && npx playwright test')['block'])
        self.assertTrue(self.check('echo heavy-gate && npx playwright test')['block'])

    def test_timeout_cannot_kill_queued_gate(self):
        for command in (f'timeout 30 {GATE} -- node smoke.js', f'timeout 30 bash -c "{GATE} -- node smoke.js"'):
            with self.subTest(command=command):
                self.assertTrue(self.check(command)['block'])
        self.assertFalse(self.check(f'{GATE} --status')['gated'])

    def test_inline_runtimes_and_heredocs(self):
        commands = [
            '''bun -e 'require("puppeteer").launch()' ''',
            '''node -e 'require("playwright").chromium.launch()' ''',
            'python3 -c "from playwright.sync_api import sync_playwright"',
            "python3 - <<'PY'\nfrom playwright.sync_api import sync_playwright\nPY",
            "bun - <<'JS'\nrequire('puppeteer').launch();\nJS",
        ]
        for command in commands:
            with self.subTest(command=command):
                self.assertTrue(self.check(command)['block'])
        self.assertFalse(self.check('bun -e "console.log(2+2)"')['block'])

    def test_script_and_local_import_resolution_use_call_cwd(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'runner.mjs').write_text('import "./browser.mjs";')
            (root / 'browser.mjs').write_text('import { chromium } from "playwright";')
            (root / 'smoke.sh').write_text('#!/bin/sh\nnode runner.mjs\n')
            for command in ('node runner.mjs', 'bash smoke.sh', './smoke.sh'):
                with self.subTest(command=command):
                    self.assertTrue(self.check(command, cwd=root)['block'])
            self.assertFalse(self.check(f'{GATE} -- bash smoke.sh', cwd=root)['block'])

    def test_package_scripts_and_npm_lifecycle(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'package.json').write_text(json.dumps({'scripts': {
                'test': 'node unit.js', 'pretest': 'playwright test',
                'smoke': 'node browser.mjs', 'lint': 'printf lint',
            }}))
            (root / 'browser.mjs').write_text('import puppeteer from "puppeteer";')
            for command in ('npm test', 'npm run smoke', 'pnpm smoke', 'bun run smoke', 'yarn smoke'):
                with self.subTest(command=command):
                    self.assertTrue(self.check(command, cwd=root)['block'])
            self.assertFalse(self.check('npm run lint', cwd=root)['block'])

    def test_bun_cwd_selects_target_package_scripts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            project = root / 'project'
            project.mkdir()
            (root / 'package.json').write_text(json.dumps({'scripts': {'smoke': 'printf ordinary'}}))
            (project / 'package.json').write_text(json.dumps({'scripts': {
                'smoke': 'node browser.mjs', 'lint': 'printf clean',
            }}))
            (project / 'browser.mjs').write_text('import puppeteer from "puppeteer";')
            for command in (
                'bun --cwd project run smoke',
                'bun --cwd=project run smoke',
                'bun --smol --cwd project run smoke',
            ):
                with self.subTest(command=command):
                    self.assertTrue(self.check(command, cwd=root)['block'])
            self.assertFalse(self.check('bun run smoke', cwd=root)['block'])
            self.assertFalse(self.check('bun --cwd project run lint', cwd=root)['block'])
            gated = self.check(f'{GATE} -- bun --cwd project run smoke', cwd=root)
            self.assertFalse(gated['block'])
            self.assertTrue(gated['gated'])

    def test_bun_leading_options_preserve_inline_and_stdin_checks(self):
        with tempfile.TemporaryDirectory() as tmp:
            for command in (
                '''bun --smol -e 'require("puppeteer").launch()' ''',
                '''bun --cwd . -e 'require("puppeteer").launch()' ''',
                '''bun --cwd=. --print 'require("puppeteer").launch()' ''',
                "bun --cwd . - <<'JS'\nrequire('puppeteer').launch();\nJS",
            ):
                with self.subTest(command=command):
                    self.assertTrue(self.check(command, cwd=tmp)['block'])
            self.assertFalse(self.check('bun --smol --cwd . -e "console.log(42)"', cwd=tmp)['block'])
            self.assertFalse(self.check("bun --cwd . - <<'JS'\nconsole.log(42);\nJS", cwd=tmp)['block'])

    def test_bun_preloads_are_resolved_after_cwd_options(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            project = root / 'project'
            project.mkdir()
            (root / 'preload.cjs').write_text('console.log("ordinary");')
            (project / 'preload.cjs').write_text('require("puppeteer").launch();')
            (project / 'main.cjs').write_text('console.log("ordinary");')
            self.assertTrue(self.check('bun --cwd project --require ./preload.cjs main.cjs', cwd=root)['block'])
            self.assertFalse(self.check('bun --cwd project main.cjs', cwd=root)['block'])

    def test_nonlaunching_cli_operations_remain_usable(self):
        for command in ('npx playwright --version', 'npx playwright install', 'npx playwright test --list', 'chrome --version'):
            with self.subTest(command=command):
                self.assertFalse(self.check(command)['block'])
        for command in ('chrome', 'electron app.js', 'npx playwright screenshot https://example.com out.png'):
            with self.subTest(command=command):
                self.assertTrue(self.check(command)['block'])

    def test_native_browser_each_open_requires_explicit_attachment(self):
        js = 'await browser.open({app: {cdp_url: "http://127.0.0.1:9222"}, name: "test"})'
        py = 'await browser.open(app={"cdp_url": "http://127.0.0.1:9222"}, name="test")'
        self.assertFalse(self.check(code=js)['block'])
        self.assertFalse(self.check(code=py, language='py')['block'])
        self.assertFalse(self.check(code='await browser.open({app: {relay: true}})')['block'])
        self.assertTrue(self.check(code=js + '; await browser.open({})')['block'])
        self.assertTrue(self.check(code='await browser.open({app: {path: "/usr/bin/chrome"}})')['block'])
        self.assertTrue(self.check(code='const p = await import("puppeteer"); await p.launch();')['block'])

    def test_invalid_checker_input_fails_closed(self):
        result = subprocess.run([str(HOOK)], input='{broken', text=True, capture_output=True, check=True)
        self.assertTrue(json.loads(result.stdout)['block'])


if __name__ == '__main__':
    unittest.main()
