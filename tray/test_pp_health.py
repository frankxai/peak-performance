"""Dependency-free tests of actual collectors and tray methods with isolated fakes.

No psutil install, GUI, process termination or generated icon is required.
"""
import ast
import importlib.util
import json
import math
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace, ModuleType
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
fake_psutil = ModuleType('psutil')
class ProbeError(Exception): pass
fake_psutil.Error = fake_psutil.AccessDenied = fake_psutil.NoSuchProcess = ProbeError
sys.modules['psutil'] = fake_psutil
spec = importlib.util.spec_from_file_location('tested_pp_monitor', ROOT / 'pp_monitor.py')
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)

def times(user=0, system=0, idle=0, irq=0, **extra):
    return SimpleNamespace(user=user, nice=0, system=system, idle=idle, irq=irq, **extra)

def row(pid, parent=0, name='node.exe', command='node fixture.js', memory=10):
    return dict(pid=pid, parentPid=parent, name=name, command=command, memMB=memory)

class ProbeTests(unittest.TestCase):
    def test_actual_host_crash_collector_is_measured_on_windows_or_unsupported_on_posix(self):
        result = monitor.probe_crashes()
        self.assertEqual(result['status'], 'measured' if monitor.os.name == 'nt' else 'unsupported')

    def test_capacity_collectors_use_javascript_half_rounding(self):
        vm = SimpleNamespace(total=200 * 1024**2, available=21.5 * 1024**2)
        with patch.object(fake_psutil, 'virtual_memory', return_value=vm, create=True):
            self.assertEqual(monitor.probe_memory(), {'totalMB': 200, 'freeMB': 22, 'usedPct': 89})
        usage = SimpleNamespace(total=100 * 1024**3, free=19.95 * 1024**3, percent=80.5)
        with patch.object(fake_psutil, 'disk_usage', return_value=usage, create=True):
            disk = monitor.probe_disk('C:/fixture')
            self.assertEqual((disk['totalGB'], disk['freeGB'], disk['usedPct']), (100, 20, 81))

    def test_windows_irq_is_not_added_twice(self):
        self.assertEqual(monitor._cpu_delta([times()], [times(20, 10, 70, 5)], True), (30, 10))
        old = SimpleNamespace(user=20, system=10, idle=70, interrupt=5, dpc=2)
        self.assertEqual(monitor._cpu_delta([times()], [old], True), (30, 10))

    def test_posix_irq_and_half_rounding(self):
        self.assertEqual(monitor._cpu_delta([times()], [times(20, 10, 65, 5)], False), (35, 15))
        self.assertEqual(monitor._cpu_delta([times()], [times(0, 1, 199)], True), (1, 1))

    def test_missing_zero_rollback_nan_are_unknown(self):
        for before, after in [([], []), ([times()], []), ([times()], [times()]),
                              ([times(2)], [times(1)]), ([times()], [times(math.nan)])]:
            self.assertIsNone(monitor._cpu_delta(before, after, True))

    def test_collector_uses_two_raw_samples(self):
        with patch.object(fake_psutil, 'cpu_times', side_effect=[[times()], [times(20, 10, 70, 5)]], create=True) as samples, \
                patch.object(fake_psutil, 'cpu_count', return_value=1, create=True), patch.object(monitor.time, 'sleep'), patch.object(monitor.os, 'name', 'nt'):
            result = monitor.probe_cpu()
        self.assertEqual(samples.call_count, 2)
        self.assertEqual((result['status'], result['loadPct'], result['systemLoadPct']), ('measured', 30, 10))

    def test_process_tree_leaf_duplicates_and_runtime(self):
        rows = [row(1, name='codex.exe', command='codex', memory=100),
                row(2, 1, command='node mcp-server.js'), row(3, 2, command='node mcp-server.js'),
                row(4, 1, command='node mcp-server.js'),
                row(5, name='node_repl.exe', command='openai codex'),
                row(6, name='notclaude.exe', command='notclaude')]
        result = monitor._process_metrics(rows)
        self.assertEqual(result['status'], 'measured')
        self.assertEqual(result['codexCount'], 1)
        self.assertEqual(result['claudeCount'], 0)
        self.assertEqual(result['codexTaskRuntimeCount'], 1)
        self.assertEqual(result['mcpProcessCount'], 3)
        self.assertEqual(result['mcpCount'], 2)
        self.assertEqual(result['duplicateMcpProcesses'], 1)
        self.assertEqual(result['agentTreeMemoryMB'], 130)
        self.assertNotIn('processes', result)  # Commands remain transient.

    def test_denied_runtime_commands_and_partial_rows_are_unknown(self):
        for name in ['node.exe', 'node_repl.exe', 'pythonw.exe', 'uvx.exe', 'pwsh.exe']:
            self.assertEqual(monitor._process_metrics([row(1, name=name, command=None)])['status'], 'unknown', name)
        self.assertEqual(monitor._process_metrics([row(1, name='System', command=None)])['status'], 'measured')
        for rows in [[], [row(1, memory=None)], [row(1), row(1)]]:
            self.assertEqual(monitor._process_metrics(rows)['status'], 'unknown')
        self.assertEqual(monitor._process_metrics([row(1)], False)['status'], 'unknown')

    def test_mcp_signatures_redact_secret_values_before_duplicate_counting(self):
        rows = [row(1, command='node mcp-server.js --token fixture-one'), row(2, command='node mcp-server.js --token fixture-two')]
        self.assertEqual(monitor._process_metrics(rows)['duplicateMcpProcesses'], 1)
        self.assertNotIn('fixture-one', monitor._redact_command(rows[0]['command']))

    def test_process_collector_does_not_hide_failed_enumeration(self):
        with patch.object(fake_psutil, 'process_iter', side_effect=ProbeError, create=True):
            self.assertEqual(monitor.probe_processes()['status'], 'unknown')

    def test_crashes_are_unsupported_on_posix(self):
        with patch.object(monitor.os, 'name', 'posix'), patch.object(monitor.subprocess, 'run', side_effect=AssertionError('must not execute')):
            self.assertEqual(monitor.probe_crashes()['status'], 'unsupported')

    def test_crashes_distinguish_no_events_from_failed_or_malformed_collection(self):
        with patch.object(monitor.os, 'name', 'nt'):
            zero = {'status': 'measured', 'totalCrashes': 0, 'topAppCrashes': 0, 'topApp': '', 'apps': []}
            with patch.object(monitor.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout=json.dumps(zero))) as run:
                self.assertEqual(monitor.probe_crashes()['status'], 'measured')
                args, kwargs = run.call_args
                self.assertIsInstance(args[0], list)
                self.assertNotIn('shell', kwargs)
                self.assertEqual(kwargs['timeout'], 8)
                self.assertEqual(kwargs['creationflags'], getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                self.assertIn('NoMatchingEventsFound', args[0][-1])
                self.assertIn('AppName', args[0][-1])
                self.assertNotIn('.Message', args[0][-1])
            for stdout in ['', '{}', '[]', json.dumps({**zero, 'totalCrashes': -1})]:
                with patch.object(monitor.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout=stdout)):
                    self.assertEqual(monitor.probe_crashes()['status'], 'unknown')
            with patch.object(monitor.subprocess, 'run', side_effect=subprocess.TimeoutExpired('powershell', 8)):
                self.assertEqual(monitor.probe_crashes()['status'], 'unknown')

def tray_class(probe, audit):
    tree = ast.parse((ROOT / 'pp_tray.py').read_text(encoding='utf-8'))
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef))
    cls.body = [n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name in {'_gate_bar', '_probe_cycle', '_update_icon'}]
    for method in cls.body:
        method.returns = None
        for arg in method.args.args: arg.annotation = None
    namespace = {'run_all_probes': probe, 'run_audit': audit, 'GATE_NAMES': {}}
    exec(compile(ast.Module(body=[cls], type_ignores=[]), str(ROOT / 'pp_tray.py'), 'exec'), namespace)
    instance = namespace['PeakPerformanceTray']()
    instance.cwd = 'fixture'; instance.theme = 'plain'; instance.alert_threshold = 60
    instance.score = 90; instance.grade_str = 'A+'; instance.gates = {}; instance.last_alert_score = 90
    instance.icon = SimpleNamespace(title='', notify=lambda *a: None)
    instance._create_icon = lambda text, color: text  # No image generation or GUI.
    instance._get_grade_color = lambda grade: (0, 0, 0)
    instance.saved = []
    instance._save_history = instance.saved.append
    return instance

class TrayTests(unittest.TestCase):
    def test_unknown_to_measured_low_score_alerts_once(self):
        probes = {'memory': {'freeMB': 5000}, 'processes': {'claudeCount': 0}, 'disk': {'freeGB': 500}}
        audit = {'totalScore': 40, 'grade': 'D', 'gateScores': {'cpu': 2}}
        app = tray_class(lambda cwd: probes, lambda p: audit)
        app.last_alert_score = None
        notifications = []
        app.icon.notify = lambda *a: notifications.append(a)
        app._probe_cycle(); app._probe_cycle()
        self.assertEqual(len(notifications), 1)
        self.assertIn('Current score is 40', notifications[0][0])

    def test_unknown_updates_icon_tooltip_history_without_arithmetic_or_alert(self):
        probes = {'memory': {'freeMB': 0}, 'processes': {'claudeCount': 0}, 'disk': {'freeGB': 0}}
        audit = {'totalScore': None, 'grade': 'UNKNOWN', 'gateScores': {'cpu': None, 'memory': None, 'disk': None, 'processes': None}}
        app = tray_class(lambda cwd: probes, lambda p: audit)
        notifications = []
        app.icon.notify = lambda *a: notifications.append(a)
        app._probe_cycle()
        self.assertIsNone(app.score)
        self.assertEqual(app.grade_str, 'UNKNOWN')
        self.assertEqual(app.icon.icon, '?')
        self.assertIn('Unknown', app.icon.title)
        self.assertNotIn('None', app.icon.title)
        self.assertNotIn('Disk: 0GB', app.icon.title)
        self.assertNotIn('RAM: 0.0GB', app.icon.title)
        self.assertNotIn('Claude: 0', app.icon.title)
        self.assertNotIn('probe error', app.icon.title)
        self.assertEqual(app.gates, audit['gateScores'])
        self.assertEqual(notifications, [])
        self.assertEqual(app.saved, [audit])
        self.assertIsNone(app.last_alert_score)
        self.assertIn('Unknown', app._gate_bar(None))

    def test_mixed_tooltip_qualifies_only_the_unknown_fragment(self):
        probes = {'memory': {'freeMB': 5000}, 'processes': {'claudeCount': 0}, 'disk': {'freeGB': 0}}
        audit = {'totalScore': None, 'grade': 'UNKNOWN', 'gateScores': {'memory': 10, 'processes': 10, 'disk': None}}
        app = tray_class(lambda cwd: probes, lambda p: audit)
        app._probe_cycle()
        self.assertIn('RAM: 4.9GB free', app.icon.title)
        self.assertIn('Disk: Unknown', app.icon.title)
        self.assertIn('Claude: 0', app.icon.title)

    def test_failed_probe_replaces_stale_healthy_grade(self):
        def fail(cwd): raise OSError('fixture')
        app = tray_class(fail, lambda p: self.fail('must not score'))
        app._probe_cycle()
        self.assertIsNone(app.score)
        self.assertEqual(app.grade_str, 'UNKNOWN')
        self.assertEqual(app.icon.icon, '?')
        self.assertEqual(app.gates, {})

if __name__ == '__main__': unittest.main()
