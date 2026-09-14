"""Resolve AGENT_HOME for standalone skill scripts.

Skill scripts may run outside the Agent process (system Python, nix env,
CI) where ``agent_constants`` is not importable.  This module provides the
same ``get_agent_home()`` contract without requiring it on ``sys.path``.

When ``agent_constants`` IS available it is used directly so profile
resolution and any future enhancements are picked up automatically.
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from agent_constants import get_agent_home as get_agent_home
except (ModuleNotFoundError, ImportError):

    def get_agent_home() -> Path:
        """Return the Agent home directory (default: ``~/.agent``)."""
        val = os.environ.get("AGENT_HOME", "").strip()
        return Path(val) if val else Path.home() / ".agent"
