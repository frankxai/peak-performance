"""
Peak Performance Tray — System tray application.
Lightweight always-on system monitor showing machine health in the Windows tray.
Target: <15MB RAM footprint.
"""

import json
import os
import socket
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone

from PIL import Image, ImageDraw, ImageFont
import pystray

from pp_config import CONFIG, GATE_NAMES, GRADE_COLORS
from pp_monitor import run_all_probes
from pp_scoring import run_audit


class PeakPerformanceTray:
    """System tray application for Peak Performance monitoring."""

    def __init__(self):
        self.cwd = CONFIG['cwd']
        self.theme = CONFIG['theme']
        self.refresh_interval = CONFIG['refresh_interval']
        self.alert_threshold = CONFIG['alert_threshold']
        self.history_path = os.path.join(self.cwd, CONFIG['history_path'])

        # Current state
        self.score = 0
        self.grade_str = '?'
        self.gates = {}
        self.mem_free_mb = 0
        self.claude_count = 0
        self.disk_free_gb = 0
        self.tooltip = 'PP: initializing...'
        self.last_alert_score = 100  # track to avoid repeated alerts

        # Build the tray
        self.icon = pystray.Icon(
            name='peak-performance',
            icon=self._create_icon('?', (128, 128, 128)),
            title=self.tooltip,
            menu=self._build_menu(),
        )

        self._stop_event = threading.Event()

    # ─── Icon Generation ────────────────────────────────────────

    def _create_icon(self, text: str, color: tuple) -> Image.Image:
        """Create a 64x64 icon: colored circle with score text."""
        size = 64
        img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)

        # Draw filled circle
        margin = 2
        draw.ellipse(
            [margin, margin, size - margin, size - margin],
            fill=(*color, 240),
            outline=(255, 255, 255, 200),
            width=2,
        )

        # Draw text centered
        # Try to get a clean font; fall back to default
        font = None
        font_size = 26 if len(text) <= 2 else 20
        try:
            # Try common Windows fonts
            for font_name in ['arialbd.ttf', 'arial.ttf', 'segoeui.ttf', 'calibrib.ttf']:
                try:
                    font = ImageFont.truetype(font_name, font_size)
                    break
                except OSError:
                    continue
        except Exception:
            pass

        if font is None:
            font = ImageFont.load_default()

        # Center text
        bbox = draw.textbbox((0, 0), text, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        tx = (size - tw) // 2
        ty = (size - th) // 2 - 2

        # Draw text shadow then text
        draw.text((tx + 1, ty + 1), text, fill=(0, 0, 0, 180), font=font)
        draw.text((tx, ty), text, fill=(255, 255, 255, 255), font=font)

        return img

    def _get_grade_color(self, g: str) -> tuple:
        return GRADE_COLORS.get(g, (128, 128, 128))

    # ─── Menu ───────────────────────────────────────────────────

    def _build_menu(self) -> pystray.Menu:
        return pystray.Menu(
            pystray.MenuItem(
                lambda _: f'Score: {self.score}/{self.grade_str}',
                None,
                enabled=False,
            ),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem('Full Audit', self._on_full_audit),
            pystray.MenuItem('Snapshot', self._on_snapshot),
            pystray.MenuItem('Fix Issues', self._on_fix),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem('View Trend', self._on_trend),
            pystray.MenuItem('Open History', self._on_open_history),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem(
                lambda _: f"Theme: {'Arcanea' if self.theme == 'arcanea' else 'Plain'}",
                self._on_toggle_theme,
            ),
            pystray.MenuItem('Refresh Now', self._on_refresh),
            pystray.MenuItem('Quit', self._on_quit),
        )

    # ─── Menu Actions ───────────────────────────────────────────

    def _open_terminal(self, cmd: str):
        """Open a new terminal window running a command."""
        try:
            subprocess.Popen(
                f'start cmd /k "cd /d {self.cwd} && {cmd}"',
                shell=True,
            )
        except Exception:
            pass

    def _on_full_audit(self, icon, item):
        self._open_terminal('npx @arcanea/peak-performance audit')

    def _on_snapshot(self, icon, item):
        self._open_terminal('npx @arcanea/peak-performance snapshot')

    def _on_fix(self, icon, item):
        self._open_terminal('npx @arcanea/peak-performance fix')

    def _on_trend(self, icon, item):
        self._open_terminal('npx @arcanea/peak-performance trend')

    def _on_open_history(self, icon, item):
        """Open history.json in the default editor."""
        try:
            if os.path.exists(self.history_path):
                os.startfile(self.history_path)
            else:
                self.icon.notify(
                    'No history file yet. Run an audit first.',
                    'Peak Performance',
                )
        except Exception:
            pass

    def _on_toggle_theme(self, icon, item):
        self.theme = 'plain' if self.theme == 'arcanea' else 'arcanea'
        self._update_icon()

    def _on_refresh(self, icon, item):
        threading.Thread(target=self._probe_cycle, daemon=True).start()

    def _on_quit(self, icon, item):
        self._stop_event.set()
        icon.stop()

    # ─── Probe Cycle ────────────────────────────────────────────

    def _probe_cycle(self):
        """Run all probes, score, update icon and history."""
        try:
            probes = run_all_probes(self.cwd)
            audit = run_audit(probes)

            self.score = audit['totalScore']
            self.grade_str = audit['grade']
            self.gates = audit['gateScores']
            self.mem_free_mb = probes['memory']['freeMB']
            self.claude_count = probes['processes']['claudeCount']
            self.disk_free_gb = probes['disk']['freeGB']

            # Update tooltip
            mem_free_gb = round(self.mem_free_mb / 1024, 1)
            self.tooltip = (
                f'PP {self.score}/{self.grade_str} | '
                f'{mem_free_gb}GB free | '
                f'{self.claude_count} Claude | '
                f'{self.disk_free_gb}GB disk'
            )

            # Save to history
            self._save_history(audit)

            # Alert on low score
            if self.score < self.alert_threshold and self.last_alert_score >= self.alert_threshold:
                try:
                    self.icon.notify(
                        f'Score dropped to {self.score}/{self.grade_str}. '
                        f'Run "pp fix" to resolve issues.',
                        'Peak Performance Alert',
                    )
                except Exception:
                    pass

            self.last_alert_score = self.score

            # Update icon
            self._update_icon()

        except Exception as e:
            # Don't crash the tray on probe failure
            self.tooltip = f'PP: probe error — {str(e)[:60]}'
            try:
                self.icon.title = self.tooltip
            except Exception:
                pass

    def _update_icon(self):
        """Refresh the tray icon image and tooltip."""
        color = self._get_grade_color(self.grade_str)
        score_text = str(self.score)
        self.icon.icon = self._create_icon(score_text, color)
        self.icon.title = self.tooltip

    # ─── History ────────────────────────────────────────────────

    def _save_history(self, audit: dict):
        """Append audit to .pp/history.json (compatible with TS TrendTracker)."""
        entry = {
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'score': audit['totalScore'],
            'grade': audit['grade'],
            'gates': audit['gateScores'],
            'trigger': 'tray',
        }

        history_dir = os.path.dirname(self.history_path)
        os.makedirs(history_dir, exist_ok=True)

        entries = []
        if os.path.exists(self.history_path):
            try:
                with open(self.history_path, 'r', encoding='utf-8') as f:
                    entries = json.load(f)
            except (json.JSONDecodeError, OSError):
                entries = []

        entries.append(entry)

        # Trim to max
        max_h = CONFIG.get('max_history', 100)
        if len(entries) > max_h:
            entries = entries[-max_h:]

        try:
            with open(self.history_path, 'w', encoding='utf-8') as f:
                json.dump(entries, f, indent=2)
        except OSError:
            pass

    # ─── Background Loop ───────────────────────────────────────

    def _monitor_loop(self):
        """Background thread: probe every refresh_interval seconds."""
        # Initial probe immediately
        self._probe_cycle()

        while not self._stop_event.is_set():
            self._stop_event.wait(timeout=self.refresh_interval)
            if not self._stop_event.is_set():
                self._probe_cycle()

    # ─── Run ────────────────────────────────────────────────────

    def run(self):
        """Start the tray application. Blocks until quit."""
        monitor_thread = threading.Thread(target=self._monitor_loop, daemon=True)
        monitor_thread.start()
        self.icon.run()


def main():
    app = PeakPerformanceTray()
    app.run()


if __name__ == '__main__':
    main()
