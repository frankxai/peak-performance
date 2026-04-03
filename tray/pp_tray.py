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
        """Create a beautiful 64x64 icon with gradient ring, inner glow, and score."""
        size = 64
        # Render at 2x then downscale for anti-aliasing
        hires = size * 2
        img = Image.new('RGBA', (hires, hires), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        cx, cy = hires // 2, hires // 2

        # Outer glow — soft colored aura
        for radius_offset in range(12, 0, -1):
            alpha = int(25 * (1 - radius_offset / 12))
            r = cx - 4 + radius_offset
            draw.ellipse(
                [cx - r, cy - r, cx + r, cy + r],
                fill=(*color, alpha),
            )

        # Dark background circle
        r_bg = cx - 8
        draw.ellipse(
            [cx - r_bg, cy - r_bg, cx + r_bg, cy + r_bg],
            fill=(20, 22, 30, 245),
        )

        # Gradient ring — draw concentric arcs from dark to bright
        ring_width = 8
        for i in range(ring_width):
            t = i / ring_width
            # Interpolate from dim version of color to full brightness
            rc = int(color[0] * (0.3 + 0.7 * t))
            gc = int(color[1] * (0.3 + 0.7 * t))
            bc = int(color[2] * (0.3 + 0.7 * t))
            r_ring = r_bg - i
            draw.ellipse(
                [cx - r_ring, cy - r_ring, cx + r_ring, cy + r_ring],
                outline=(rc, gc, bc, 220),
                width=2,
            )

        # Inner subtle fill — very dark with a hint of color
        r_inner = r_bg - ring_width - 2
        draw.ellipse(
            [cx - r_inner, cy - r_inner, cx + r_inner, cy + r_inner],
            fill=(
                15 + color[0] // 20,
                17 + color[1] // 20,
                25 + color[2] // 20,
                240,
            ),
        )

        # Score text — large, bold, centered
        font = None
        font_size = (52 if len(text) <= 2 else 40)
        for font_name in ['seguisb.ttf', 'arialbd.ttf', 'calibrib.ttf', 'segoeui.ttf']:
            try:
                font = ImageFont.truetype(font_name, font_size)
                break
            except OSError:
                continue
        if font is None:
            font = ImageFont.load_default()

        bbox = draw.textbbox((0, 0), text, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        tx = (hires - tw) // 2
        ty = (hires - th) // 2 - 4

        # Text glow
        for dx, dy in [(-1, -1), (-1, 1), (1, -1), (1, 1), (0, -2), (0, 2), (-2, 0), (2, 0)]:
            draw.text((tx + dx, ty + dy), text, fill=(*color, 60), font=font)

        # Text shadow
        draw.text((tx + 2, ty + 2), text, fill=(0, 0, 0, 200), font=font)
        # Main text — white with slight color tint
        text_color = (
            min(255, 230 + color[0] // 25),
            min(255, 235 + color[1] // 25),
            min(255, 240 + color[2] // 25),
            255,
        )
        draw.text((tx, ty), text, fill=text_color, font=font)

        # Small grade letter at bottom
        if hasattr(self, 'grade_str') and self.grade_str and self.grade_str != '?':
            grade_font_size = 18
            grade_font = None
            for font_name in ['seguisb.ttf', 'arialbd.ttf', 'segoeui.ttf']:
                try:
                    grade_font = ImageFont.truetype(font_name, grade_font_size)
                    break
                except OSError:
                    continue
            if grade_font:
                gb = draw.textbbox((0, 0), self.grade_str, font=grade_font)
                gw = gb[2] - gb[0]
                gx = (hires - gw) // 2
                gy = hires - 28
                draw.text((gx, gy), self.grade_str, fill=(*color, 200), font=grade_font)

        # Downscale with high-quality resampling
        img = img.resize((size, size), Image.LANCZOS)
        return img

    def _get_grade_color(self, g: str) -> tuple:
        return GRADE_COLORS.get(g, (128, 128, 128))

    # ─── Menu ───────────────────────────────────────────────────

    def _gate_label(self, gid: str) -> str:
        """Get display name for a gate based on theme."""
        info = GATE_NAMES.get(gid, {})
        if self.theme == 'arcanea':
            return f"{info.get('gate', gid)} ({info.get('guardian', '')})"
        return info.get('plain', gid)

    def _gate_bar(self, score: int) -> str:
        """Visual score bar: ████░░░░░░ 6/10"""
        filled = '█' * score
        empty = '░' * (10 - score)
        return f'{filled}{empty} {score}/10'

    def _build_menu(self) -> pystray.Menu:
        # Dynamic gate submenu
        def gate_items():
            items = []
            for gid in ['disk', 'memory', 'cpu', 'processes', 'git',
                        'secrets', 'workspace', 'knowledge', 'agents', 'system']:
                score = self.gates.get(gid, 0)
                label = f'{self._gate_label(gid):28s}  {self._gate_bar(score)}'
                items.append(pystray.MenuItem(label, None, enabled=False))
            return items

        return pystray.Menu(
            pystray.MenuItem(
                lambda _: f'⚡ Score: {self.score}/100  |  Grade: {self.grade_str}',
                None,
                enabled=False,
            ),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem(
                'Gate Scores',
                pystray.Menu(lambda: gate_items()),
            ),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem('Full Audit', self._on_full_audit),
            pystray.MenuItem('Snapshot (screens + metrics)', self._on_snapshot),
            pystray.MenuItem('Auto-Fix Issues', self._on_fix),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem('View Trend History', self._on_trend),
            pystray.MenuItem('Open History File', self._on_open_history),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem(
                lambda _: f"Theme: {'⚔ Arcanea' if self.theme == 'arcanea' else '○ Plain'}",
                self._on_toggle_theme,
            ),
            pystray.MenuItem('↻ Refresh Now', self._on_refresh),
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
        self._open_terminal('npx tsx packages/peak-performance/src/cli.ts audit')

    def _on_snapshot(self, icon, item):
        self._open_terminal('npx tsx packages/peak-performance/src/cli.ts snapshot')

    def _on_fix(self, icon, item):
        self._open_terminal('npx tsx packages/peak-performance/src/cli.ts fix')

    def _on_trend(self, icon, item):
        self._open_terminal('npx tsx packages/peak-performance/src/cli.ts trend')

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

            # Update tooltip — rich multi-line summary
            mem_free_gb = round(self.mem_free_mb / 1024, 1)
            # Gate summary: show worst gates first
            gate_summary = ''
            if self.gates:
                worst = sorted(self.gates.items(), key=lambda x: x[1])[:3]
                labels = GATE_NAMES if self.theme == 'arcanea' else None
                parts = []
                for gid, gscore in worst:
                    if gscore < 8:
                        name = GATE_NAMES.get(gid, {}).get(
                            'guardian' if self.theme == 'arcanea' else 'plain', gid
                        )
                        parts.append(f'{name}:{gscore}')
                if parts:
                    gate_summary = f' | {", ".join(parts)}'

            self.tooltip = (
                f'Peak Performance {self.score}/{self.grade_str}'
                f'{gate_summary}\n'
                f'RAM: {mem_free_gb}GB free | '
                f'Disk: {self.disk_free_gb}GB | '
                f'Claude: {self.claude_count}'
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
