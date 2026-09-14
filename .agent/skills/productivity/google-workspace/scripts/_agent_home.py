"""Resolve AGENT_HOME for standalone skill scripts.

Skill scripts may run outside the Agent process (e.g. system Python,
nix env, CI) where ``agent_constants`` is not importable.  This module
provides the same ``get_agent_home()`` and ``display_agent_home()``
contracts as ``agent_constants`` without requiring it on ``sys.path``.

When ``agent_constants`` IS available it is used directly so that any
future enhancements (profile resolution, Docker detection, etc.) are
picked up automatically.  The fallback path replicates the core logic
from ``agent_constants.py`` using only the stdlib.

All scripts under ``google-workspace/scripts/`` should import from here
instead of duplicating the ``AGENT_HOME = Path(os.getenv(...))`` pattern.
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from agent_constants import display_agent_home as display_agent_home
    from agent_constants import get_agent_home as get_agent_home
except (ModuleNotFoundError, ImportError):

    def get_agent_home() -> Path:
        """Return the Agent home directory (default: ~/.agent).

        Mirrors ``agent_constants.get_agent_home()``."""
        val = os.environ.get("AGENT_HOME", "").strip()
        return Path(val) if val else Path.home() / ".agent"

    def display_agent_home() -> str:
        """Return a user-friendly ``~/``-shortened display string.

        Mirrors ``agent_constants.display_agent_home()``."""
        home = get_agent_home()
        try:
            return "~/" + home.relative_to(Path.home()).as_posix()
        except ValueError:
            return str(home)
