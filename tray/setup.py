"""
Peak Performance Tray — Installer.
Usage:
    pip install -e .
    pp-tray
"""

from setuptools import setup, find_packages

setup(
    name='pp-tray',
    version='1.0.0',
    description='Peak Performance system tray monitor for Windows',
    author='Arcanea',
    py_modules=['pp_tray', 'pp_monitor', 'pp_scoring', 'pp_config'],
    install_requires=[
        'pystray>=0.19.0',
        'psutil>=5.9.0',
        'Pillow>=10.0.0',
    ],
    entry_points={
        'console_scripts': [
            'pp-tray=pp_tray:main',
        ],
    },
    python_requires='>=3.10',
)
