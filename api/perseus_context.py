"""
Perseus Context Engine integration for Hermes WebUI.

Provides API endpoints that expose live Perseus workspace context,
service health, and memory to the dashboard. Reads the rendered
.hermes.md files that Perseus cron jobs keep fresh.
"""

from __future__ import annotations

import json
import logging
import subprocess
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# Path to the Perseus standalone artifact
_PERSEUS_PY_CANDIDATES = [
    Path("/opt/data/plugins/perseus/perseus.py"),
    Path("/workspace/perseus/perseus.py"),
    Path.home() / ".hermes" / "plugins" / "perseus" / "perseus.py",
    Path.home() / "plugins" / "perseus" / "perseus.py",
]


def _find_perseus() -> Optional[Path]:
    """Locate the Perseus artifact."""
    for candidate in _PERSEUS_PY_CANDIDATES:
        if candidate.is_file():
            return candidate
    return None


def _find_workspaces() -> list[Path]:
    """Discover workspaces with .perseus/context.md files."""
    search_roots = [
        Path("/workspace"),
        Path.home() / ".hermes" / "plugins",
        Path.home() / "plugins",
        Path.home() / ".minions",
    ]
    workspaces = []
    for root in search_roots:
        if not root.is_dir():
            continue
        for ctx_file in root.glob(".perseus/context.md"):
            workspaces.append(ctx_file.parent.parent)
        # Also search one level deeper
        for ctx_file in root.glob("*/.perseus/context.md"):
            workspaces.append(ctx_file.parent.parent)
    return sorted(set(workspaces))


def get_context(workspace: Optional[str] = None) -> Dict[str, Any]:
    """Return the rendered Perseus context for the given workspace.

    If no workspace specified, returns the first discovered workspace's context.
    """
    perseus_py = _find_perseus()
    if not perseus_py:
        return {"error": "Perseus not found", "workspaces": []}

    workspaces = _find_workspaces()
    ws_list = [str(w) for w in workspaces]

    if not workspaces:
        return {"error": "No Perseus workspaces found", "workspaces": []}

    target = Path(workspace) if workspace else workspaces[0]
    hermes_md = target / ".hermes.md"
    context_md = target / ".perseus" / "context.md"

    result = {
        "workspace": str(target),
        "all_workspaces": ws_list,
    }

    # Read the rendered context file
    if hermes_md.is_file():
        try:
            content = hermes_md.read_text(encoding="utf-8")
            result["context"] = content
            result["context_updated"] = hermes_md.stat().st_mtime
        except Exception as e:
            result["context_error"] = str(e)
    else:
        result["context"] = None
        result["context_note"] = f"No .hermes.md found — run: perseus render {context_md}"

    return result


def get_health() -> Dict[str, Any]:
    """Run perseus doctor and return health status."""
    perseus_py = _find_perseus()
    if not perseus_py:
        return {"error": "Perseus not found"}

    try:
        result = subprocess.run(
            ["python3", str(perseus_py), "doctor"],
            capture_output=True,
            text=True,
            timeout=15,
        )
        return {
            "status": "ok" if result.returncode == 0 else "warning",
            "exit_code": result.returncode,
            "output": result.stdout,
            "stderr": result.stderr,
        }
    except subprocess.TimeoutExpired:
        return {"status": "error", "error": "perseus doctor timed out"}
    except Exception as e:
        return {"status": "error", "error": str(e)}


def get_services() -> Dict[str, Any]:
    """Parse @services block from context.md and return health status."""
    workspaces = _find_workspaces()
    if not workspaces:
        return {"services": [], "error": "No Perseus workspaces found"}

    # Read the rendered .hermes.md for service status
    target = workspaces[0]
    hermes_md = target / ".hermes.md"

    if not hermes_md.is_file():
        return {"services": [], "error": "No rendered context found"}

    # Parse the services table from the rendered markdown
    content = hermes_md.read_text(encoding="utf-8")
    services = []
    in_table = False
    for line in content.split("\n"):
        if "| Service | Status | Latency |" in line:
            in_table = True
            continue
        if in_table:
            if line.startswith("|---"):
                continue
            if line.startswith("|") and "|" in line[1:]:
                parts = [p.strip() for p in line.split("|")[1:-1]]
                if len(parts) >= 2:
                    services.append({
                        "name": parts[0],
                        "status": parts[1],
                        "latency": parts[2] if len(parts) > 2 else None,
                    })
            else:
                in_table = False

    return {"services": services, "workspace": str(target)}
