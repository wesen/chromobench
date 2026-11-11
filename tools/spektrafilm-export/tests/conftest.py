"""Run with the exporter venv, isolated, from the repository root:

    SPEKTRAFILM_CHECKOUT=/path/to/spektrafilm python -I -m pytest -q tools/spektrafilm-export/tests

Tests that need the upstream checkout are skipped when SPEKTRAFILM_CHECKOUT is unset.
"""
import os
import sys
from pathlib import Path

import pytest

TOOL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOL))


@pytest.fixture(scope="session")
def checkout() -> Path:
    p = os.environ.get("SPEKTRAFILM_CHECKOUT")
    if not p:
        pytest.skip("SPEKTRAFILM_CHECKOUT not set")
    return Path(p)


@pytest.fixture(scope="session")
def repo() -> Path:
    return TOOL.parents[1]
