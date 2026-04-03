"""
Peak Performance Tray — Configuration and constants.
"""

CONFIG = {
    'refresh_interval': 60,       # seconds between probe cycles
    'cwd': r'C:\Users\frank\Arcanea',
    'theme': 'arcanea',           # 'arcanea' or 'plain'
    'alert_threshold': 50,        # score below this triggers toast notification
    'history_path': '.pp/history.json',
    'max_history': 100,
}

GATE_NAMES = {
    'disk':      {'gate': 'Foundation', 'guardian': 'Lyssandria', 'plain': 'Disk Health'},
    'memory':    {'gate': 'Flow',       'guardian': 'Leyla',      'plain': 'Memory'},
    'cpu':       {'gate': 'Fire',       'guardian': 'Draconia',   'plain': 'CPU / GPU'},
    'processes': {'gate': 'Heart',      'guardian': 'Maylinn',    'plain': 'Process Health'},
    'git':       {'gate': 'Voice',      'guardian': 'Alera',      'plain': 'Git Hygiene'},
    'secrets':   {'gate': 'Sight',      'guardian': 'Lyria',      'plain': 'Security'},
    'workspace': {'gate': 'Crown',      'guardian': 'Aiyami',     'plain': 'Workspace'},
    'knowledge': {'gate': 'Starweave',  'guardian': 'Elara',      'plain': 'Knowledge'},
    'agents':    {'gate': 'Unity',      'guardian': 'Ino',        'plain': 'Agent Load'},
    'system':    {'gate': 'Source',     'guardian': 'Shinkami',   'plain': 'System'},
}

# Grade color mapping for tray icon
GRADE_COLORS = {
    'S':  (0, 255, 100),    # bright green
    'A+': (0, 230, 80),     # green
    'A':  (50, 200, 80),    # green
    'A-': (80, 200, 80),    # green
    'B+': (0, 200, 200),    # cyan
    'B':  (0, 180, 200),    # cyan
    'B-': (0, 160, 180),    # cyan
    'C+': (255, 220, 0),    # yellow
    'C':  (255, 200, 0),    # yellow
    'C-': (255, 180, 0),    # yellow/orange
    'D+': (255, 120, 0),    # orange
    'D':  (255, 80, 0),     # orange-red
    'F':  (255, 30, 30),    # red
}
