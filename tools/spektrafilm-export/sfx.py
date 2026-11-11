"""Launcher for spektrafilm-export. Run with the exporter venv, isolated:

    python -I tools/spektrafilm-export/sfx.py export --upstream /path/to/spektrafilm
    python -I tools/spektrafilm-export/sfx.py --help

-I keeps the current directory and PYTHON* variables off sys.path; this file adds only its own
directory, and the upstream checkout is appended last by spektrafilm_export.upstream.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from spektrafilm_export.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
