"""Import the pinned upstream spektrafilm checkout without its heavy, unneeded parts.

spektrafilm's package ``__init__`` files import the whole simulator (``runtime.process``), the raw
decoder (``utils.raw_file_processor`` -> rawpy, lensfunpy) and image IO (``utils.io`` -> exiv2,
OpenImageIO). The exporter needs none of that: it reads profiles, filter tables, illuminants and
parameter defaults. So we

* register ``spektrafilm``, ``spektrafilm.runtime`` and ``spektrafilm.utils`` as bare packages
  (their ``__path__`` points at the checkout, their ``__init__`` never runs), and
* install inert stand-ins for ``exiv2`` and ``OpenImageIO`` while ``utils/io.py`` is imported (it
  imports them at module level only to read and write images), then remove them again. Any
  attribute access on them raises, so an accidental use fails loudly instead of doing something
  wrong.

Everything else (numpy, scipy, colour-science, opt-einsum, matplotlib, numba) is installed for real.
"""
from __future__ import annotations

import importlib
import subprocess
import sys
import types
from pathlib import Path

PINNED_COMMIT = "3bb2c2d2801ff68b92019cf1dbcbb133d60832bc"
UPSTREAM_REPO = "https://github.com/andreavolpato/spektrafilm"

_BARE_PACKAGES = ("spektrafilm", "spektrafilm.runtime", "spektrafilm.utils")
_STUBBED_MODULES = ("exiv2", "OpenImageIO")


class _Unavailable(types.ModuleType):
    def __getattr__(self, name: str):  # pragma: no cover - only hit on misuse
        raise RuntimeError(
            f"{self.__name__}.{name} is not available: the exporter stubs {self.__name__} "
            "because it only reads data and never decodes or writes images"
        )


def git_head(checkout: Path) -> str:
    out = subprocess.run(
        ["git", "-C", str(checkout), "rev-parse", "HEAD"], check=True, capture_output=True, text=True
    )
    return out.stdout.strip()


def git_is_clean(checkout: Path) -> bool:
    out = subprocess.run(
        ["git", "-C", str(checkout), "status", "--porcelain", "--untracked-files=no"],
        check=True, capture_output=True, text=True,
    )
    return out.stdout.strip() == ""


def load(checkout: Path, *, require_commit: str | None = PINNED_COMMIT) -> Path:
    """Make ``import spektrafilm.*`` resolve to ``checkout/src`` and return that src dir.

    Refuses a checkout that is not at ``require_commit`` or has local modifications, so a pack can
    never be exported from an unpinned tree.
    """
    checkout = checkout.resolve()
    src = checkout / "src"
    if not (src / "spektrafilm" / "profiles" / "io.py").is_file():
        raise SystemExit(f"{checkout} does not look like a spektrafilm checkout (no src/spektrafilm)")
    if require_commit is not None:
        head = git_head(checkout)
        if head != require_commit:
            raise SystemExit(f"spektrafilm checkout is at {head}, expected pinned {require_commit}")
        if not git_is_clean(checkout):
            raise SystemExit(f"spektrafilm checkout {checkout} has local modifications")

    for name in _BARE_PACKAGES:
        if name in sys.modules:
            continue
        mod = types.ModuleType(name)
        mod.__path__ = [str(src.joinpath(*name.split(".")))]
        mod.__package__ = name
        sys.modules[name] = mod
        parent, _, child = name.rpartition(".")
        if parent:
            setattr(sys.modules[parent], child, mod)
    # Upstream goes last on sys.path: it can never shadow the standard library or installed packages.
    if str(src) not in sys.path:
        sys.path.append(str(src))
    # The stand-ins exist only while utils/io.py is imported: other libraries (colour-science's
    # optional OpenImageIO support) must keep seeing the real modules as absent.
    added = [n for n in _STUBBED_MODULES if n not in sys.modules]
    for name in added:
        sys.modules[name] = _Unavailable(name)
    try:
        importlib.import_module("spektrafilm.utils.io")
    finally:
        for name in added:
            del sys.modules[name]
    return src


def module(name: str):
    return importlib.import_module(name)
