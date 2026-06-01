"""
Perseus Context Engine integration for Hermes WebUI.

Provides API endpoints for:
  - Live workspace context (rendered .hermes.md)
  - Service health dashboard (parsed @services blocks)
  - Memory search (Mneme vault FTS5)
  - Session timeline (recent sessions with waypoints)
  - Task radar (Agora task board from tasks/*.md)
  - Workspace status badges (git branch, dirty state)
  - Cold-start killer (context injection into new sessions)
"""

from __future__ import annotations

import json
import logging
import os
import re
import sqlite3
import subprocess
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Path to the Perseus standalone artifact
_PERSEUS_PY_CANDIDATES = [
    Path("/opt/data/plugins/perseus/perseus.py"),
    Path("/workspace/perseus/perseus.py"),
    Path.home() / ".hermes" / "plugins" / "perseus" / "perseus.py",
    Path.home() / "plugins" / "perseus" / "perseus.py",
]

# Mneme vault paths
_MNEME_VAULT_CANDIDATES = [
    Path.home() / ".hermes" / "mneme" / "vault.db",
    Path("/home/hermeswebui/.hermes/mneme/vault.db"),
]

# Session DB paths
_SESSION_DB_CANDIDATES = [
    Path.home() / ".hermes" / "sessions.db",
]

# Workspace search roots
_WORKSPACE_ROOTS = [
    Path("/workspace"),
    Path.home() / ".hermes" / "plugins",
    Path.home() / "plugins",
    Path.home() / ".minions",
]


def _find_perseus() -> Optional[Path]:
    for candidate in _PERSEUS_PY_CANDIDATES:
        if candidate.is_file():
            return candidate
    return None


def _find_vault_db() -> Optional[Path]:
    for candidate in _MNEME_VAULT_CANDIDATES:
        if candidate.is_file():
            return candidate
    return None


def _find_session_db() -> Optional[Path]:
    for candidate in _SESSION_DB_CANDIDATES:
        if candidate.is_file():
            return candidate
    return None


def _find_workspaces() -> List[Path]:
    workspaces = []
    for root in _WORKSPACE_ROOTS:
        if not root.is_dir():
            continue
        for depth in ["", "*", "*/*"]:
            pattern = f"{depth}/.perseus/context.md" if depth else ".perseus/context.md"
            for ctx_file in root.glob(pattern):
                ws = ctx_file.parent.parent
                if ws not in workspaces:
                    workspaces.append(ws)
    return sorted(set(workspaces))


def _resolve_workspace(workspace: Optional[str]) -> Optional[Path]:
    workspaces = _find_workspaces()
    if not workspaces:
        return None
    if workspace:
        target = Path(workspace)
        if target in workspaces:
            return target
    return workspaces[0]


# ═══════════════════════════════════════════════════════════════════════
# A: Service Health Dashboard
# ═══════════════════════════════════════════════════════════════════════

def get_services(workspace: Optional[str] = None) -> Dict[str, Any]:
    """Parse @services blocks from context.md and probe each service live."""
    target = _resolve_workspace(workspace)
    if not target:
        return {"services": [], "error": "No Perseus workspaces found"}

    context_md = target / ".perseus" / "context.md"
    if not context_md.is_file():
        return {"services": [], "error": "No context.md found"}

    content = context_md.read_text(encoding="utf-8")
    services = _parse_services_block(content)
    
    # Probe each service live
    for svc in services:
        svc["live_status"] = _probe_service(svc)
    
    # Also read rendered table for comparison
    hermes_md = target / ".hermes.md"
    rendered_services = []
    if hermes_md.is_file():
        rendered_services = _parse_rendered_services(hermes_md.read_text(encoding="utf-8"))

    return {
        "workspace": str(target),
        "services": services,
        "rendered_services": rendered_services,
        "total": len(services),
        "healthy": sum(1 for s in services if s.get("live_status") == "healthy"),
        "unhealthy": sum(1 for s in services if s.get("live_status") == "unhealthy"),
    }


def _parse_services_block(content: str) -> List[Dict[str, Any]]:
    """Parse @services YAML block from context.md — no yaml dependency."""
    services = []
    in_block = False
    current = {}
    
    for line in content.split("\n"):
        stripped = line.strip()
        if stripped.startswith("@services"):
            in_block = True
            continue
        if not in_block:
            continue
        if stripped.startswith("@end"):
            if current:
                services.append(current)
            break
        if stripped.startswith("- name:"):
            if current:
                services.append(current)
            current = {"name": stripped.split(":", 1)[1].strip(), "command": "", "url": "", "warn_on_error": False}
        elif stripped.startswith("command:") and current:
            current["command"] = stripped.split(":", 1)[1].strip().strip('"')
        elif stripped.startswith("url:") and current:
            current["url"] = stripped.split(":", 1)[1].strip()
        elif stripped.startswith("warn_on_error:") and current:
            current["warn_on_error"] = "true" in stripped.lower()
    
    if current and current.get("name"):
        services.append(current)
    
    return services


def _parse_rendered_services(content: str) -> List[Dict[str, str]]:
    """Parse the rendered services table from .hermes.md."""
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
                        "latency": parts[2] if len(parts) > 2 else "",
                    })
            elif not line.startswith("|"):
                break
    return services


def _probe_service(svc: Dict[str, Any]) -> str:
    """Probe a service and return status: healthy, unhealthy, or unknown."""
    cmd = svc.get("command", "")
    url = svc.get("url", "")
    
    # Prefer URL probes
    if url:
        try:
            import urllib.request
            req = urllib.request.Request(url, headers={"User-Agent": "Perseus/1.0"})
            resp = urllib.request.urlopen(req, timeout=5)
            return "healthy" if resp.status < 400 else "unhealthy"
        except Exception:
            return "unhealthy"
    
    # Command probe
    if cmd:
        try:
            result = subprocess.run(
                cmd, shell=True, capture_output=True, text=True, timeout=10
            )
            return "healthy" if result.returncode == 0 else "unhealthy"
        except Exception:
            return "unhealthy"
    
    return "unknown"


# ═══════════════════════════════════════════════════════════════════════
# B: Memory Search Bar
# ═══════════════════════════════════════════════════════════════════════

def search_memory(query: str, limit: int = 10) -> Dict[str, Any]:
    """Search the Mneme vault via SQLite FTS5."""
    db_path = _find_vault_db()
    if not db_path:
        return {"results": [], "error": "Mneme vault not found", "total": 0}

    if not query or not query.strip():
        return {"results": [], "error": "Query required", "total": 0}

    try:
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        
        # Try FTS5 search on memories_fts table
        results = []
        try:
            # Escape FTS5 special chars and wrap in quotes for phrase search
            safe_query = query.replace('"', '""')
            rows = conn.execute(
                "SELECT path, snippet(memories_fts, 1, '<mark>', '</mark>', '...', 40) as snippet, "
                "rank FROM memories_fts WHERE memories_fts MATCH ? ORDER BY rank LIMIT ?",
                (f'"{safe_query}"', limit)
            ).fetchall()
            
            for row in rows:
                doc_path = row["path"]
                snippet = row["snippet"]
                # Read the actual document for metadata
                if doc_path and Path(doc_path).is_file():
                    doc_content = Path(doc_path).read_text(encoding="utf-8")[:2000]
                    title = _extract_title(doc_content)
                    tags = _extract_tags(doc_content)
                else:
                    title = doc_path or "Unknown"
                    tags = []
                
                results.append({
                    "path": doc_path,
                    "title": title,
                    "snippet": snippet,
                    "tags": tags,
                })
        except Exception as e:
            # FTS5 might not exist yet — fall back to LIKE search
            try:
                like_q = f"%{query}%"
                rows = conn.execute(
                    "SELECT path, substr(content, 1, 300) as snippet FROM documents "
                    "WHERE content LIKE ? LIMIT ?",
                    (like_q, limit)
                ).fetchall()
                for row in rows:
                    results.append({
                        "path": row["path"],
                        "title": row["path"] or "Unknown",
                        "snippet": row["snippet"],
                        "tags": [],
                    })
            except Exception:
                pass
        
        conn.close()
        
        return {
            "results": results,
            "total": len(results),
            "query": query,
            "vault": str(db_path),
        }
    except Exception as e:
        return {"results": [], "error": str(e), "total": 0}


def _extract_title(content: str) -> str:
    for line in content.split("\n"):
        line = line.strip()
        if line.startswith("# "):
            return line[2:].strip()
        if line.startswith("title:"):
            return line.split(":", 1)[1].strip().strip('"')
    return "Untitled"


def _extract_tags(content: str) -> List[str]:
    for line in content.split("\n"):
        if line.strip().startswith("tags:"):
            tags_str = line.split(":", 1)[1].strip()
            return [t.strip() for t in tags_str.replace("[", "").replace("]", "").split(",") if t.strip()]
    return []


# ═══════════════════════════════════════════════════════════════════════
# C: Session Timeline
# ═══════════════════════════════════════════════════════════════════════

def get_sessions(workspace: Optional[str] = None, limit: int = 20) -> Dict[str, Any]:
    """Return recent sessions with waypoint markers."""
    target = _resolve_workspace(workspace)
    
    sessions = []
    
    # Try session DB first
    db_path = _find_session_db()
    if db_path:
        try:
            conn = sqlite3.connect(str(db_path))
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT session_id, title, created_at, updated_at, message_count, "
                "platform, model, is_active FROM sessions ORDER BY updated_at DESC LIMIT ?",
                (limit,)
            ).fetchall()
            for row in rows:
                sessions.append({
                    "session_id": row["session_id"],
                    "title": row["title"] or "Untitled",
                    "created": row["created_at"],
                    "updated": row["updated_at"],
                    "messages": row["message_count"] or 0,
                    "platform": row["platform"] or "webui",
                    "model": row["model"] or "",
                    "active": bool(row["is_active"]),
                })
            conn.close()
        except Exception as e:
            logger.debug(f"Session DB error: {e}")
    
    # Also check Perseus waypoints
    if target:
        checkpoints_dir = target / ".perseus" / "checkpoints"
        waypoints = []
        if checkpoints_dir.is_dir():
            for cp_file in sorted(checkpoints_dir.glob("*.yaml"), reverse=True)[:10]:
                try:
                    with open(cp_file) as f:
                        cp_text = f.read()
                    cp = {}
                    for cp_line in cp_text.split("\n"):
                        if ":" in cp_line:
                            k, v = cp_line.split(":", 1)
                            cp[k.strip()] = v.strip().strip('"')
                    waypoints.append({
                        "timestamp": cp.get("timestamp", ""),
                        "task": cp.get("task", ""),
                        "status": cp.get("status", ""),
                        "summary": cp.get("summary", "")[:200],
                    })
                except Exception:
                    pass
        
        return {
            "workspace": str(target),
            "sessions": sessions,
            "waypoints": waypoints,
            "total_sessions": len(sessions),
            "total_waypoints": len(waypoints),
        }
    
    return {
        "workspace": str(target) if target else None,
        "sessions": sessions,
        "waypoints": [],
        "total_sessions": len(sessions),
        "total_waypoints": 0,
    }


# ═══════════════════════════════════════════════════════════════════════
# D: Task Radar (Agora)
# ═══════════════════════════════════════════════════════════════════════

def get_tasks(workspace: Optional[str] = None, status: Optional[str] = None) -> Dict[str, Any]:
    """Parse tasks from tasks/*.md files in the workspace."""
    target = _resolve_workspace(workspace)
    if not target:
        return {"tasks": [], "error": "No workspace found", "total": 0}
    
    tasks_dir = target / "tasks"
    if not tasks_dir.is_dir():
        return {"tasks": [], "workspace": str(target), "total": 0, "note": "No tasks/ directory"}
    
    tasks = []
    for task_file in sorted(tasks_dir.glob("*.md")):
        try:
            content = task_file.read_text(encoding="utf-8")
            task = _parse_task_file(task_file.stem, content)
            if status and task.get("status") != status:
                continue
            tasks.append(task)
        except Exception:
            pass
    
    return {
        "workspace": str(target),
        "tasks": tasks,
        "total": len(tasks),
        "open": sum(1 for t in tasks if t.get("status") == "open"),
        "in_progress": sum(1 for t in tasks if t.get("status") == "in_progress"),
        "completed": sum(1 for t in tasks if t.get("status") == "completed"),
    }


def _parse_task_file(name: str, content: str) -> Dict[str, Any]:
    """Parse a task markdown file for metadata."""
    task = {
        "id": name,
        "title": name,
        "status": "open",
        "scope": "",
        "assignee": "",
        "summary": "",
    }
    
    # Parse YAML frontmatter if present
    if content.startswith("---"):
        end = content.find("\n---", 3)
        if end > 0:
            try:
                fm_text = content[4:end]
                for fm_line in fm_text.split("\n"):
                    if ":" in fm_line and not fm_line.strip().startswith("#"):
                        k, v = fm_line.split(":", 1)
                        k = k.strip()
                        v = v.strip().strip('"')
                        if k and v:
                            task[k] = v
            except Exception:
                pass
    
    # Extract title from first heading
    for line in content.split("\n"):
        line = line.strip()
        if line.startswith("# ") and not line.startswith("## "):
            task["title"] = line[2:].strip()
            break
    
    # First paragraph as summary
    body_start = content.find("\n\n") + 2 if "\n\n" in content else 0
    if body_start > 0:
        body = content[body_start:].strip()
        task["summary"] = body[:200]
    
    return task


# ═══════════════════════════════════════════════════════════════════════
# E: Workspace Status Badges
# ═══════════════════════════════════════════════════════════════════════

def get_workspace_status(workspace: Optional[str] = None) -> Dict[str, Any]:
    """Return status badges for each workspace (git branch, dirty, last refresh)."""
    workspaces = _find_workspaces()
    
    result = {"workspaces": []}
    
    for ws in workspaces:
        status = {
            "path": str(ws),
            "name": "/".join(ws.parts[-2:]),
            "git_branch": _get_git_branch(ws),
            "git_dirty": _get_git_dirty(ws),
            "context_fresh": _get_context_freshness(ws),
            "has_tasks": (ws / "tasks").is_dir(),
            "services_count": _get_services_count(ws),
        }
        result["workspaces"].append(status)
    
    if workspace:
        target = Path(workspace)
        result["active"] = next((w for w in result["workspaces"] if w["path"] == str(target)), None)
    
    return result


def _get_git_branch(ws: Path) -> Optional[str]:
    try:
        head = ws / ".git" / "HEAD"
        if head.is_file():
            ref = head.read_text(encoding="utf-8").strip()
            if ref.startswith("ref: refs/heads/"):
                return ref[16:]
        return None
    except Exception:
        return None


def _get_git_dirty(ws: Path) -> bool:
    try:
        # Quick check: any unstaged changes?
        index = ws / ".git" / "index"
        if not index.is_file():
            return False
        # Check for modified files via git status porcelain
        result = subprocess.run(
            ["git", "-C", str(ws), "status", "--porcelain"],
            capture_output=True, text=True, timeout=5
        )
        return bool(result.stdout.strip())
    except Exception:
        return False


def _get_context_freshness(ws: Path) -> Optional[float]:
    hermes_md = ws / ".hermes.md"
    if hermes_md.is_file():
        age = time.time() - hermes_md.stat().st_mtime
        return round(age, 0)  # seconds
    return None


def _get_services_count(ws: Path) -> int:
    ctx = ws / ".perseus" / "context.md"
    if ctx.is_file():
        content = ctx.read_text(encoding="utf-8")
        return content.count("  - name:")
    return 0


# ═══════════════════════════════════════════════════════════════════════
# F: Cold-Start Killer — Context Injection
# ═══════════════════════════════════════════════════════════════════════

def get_context_injection(workspace: Optional[str] = None) -> Dict[str, Any]:
    """Return the Perseus context formatted for system prompt injection.
    
    This is meant to be prepended to the agent's system prompt so every
    new session starts with full workspace state — zero cold-start.
    """
    target = _resolve_workspace(workspace)
    if not target:
        return {"injection": None, "error": "No workspace found"}
    
    hermes_md = target / ".hermes.md"
    
    if not hermes_md.is_file():
        # Try to render on demand
        context_md = target / ".perseus" / "context.md"
        if context_md.is_file():
            perseus_py = _find_perseus()
            if perseus_py:
                try:
                    env = os.environ.copy()
                    env["PERSEUS_ALLOW_DANGEROUS"] = "1"
                    subprocess.run(
                        ["python3", str(perseus_py), "render", str(context_md)],
                        capture_output=True, text=True, timeout=30,
                        cwd=str(target), env=env
                    )
                except Exception:
                    pass
    
    if not hermes_md.is_file():
        return {"injection": None, "error": "No rendered context available"}
    
    content = hermes_md.read_text(encoding="utf-8")
    
    # Truncate to ~4000 chars for prompt injection
    if len(content) > 4000:
        # Keep first 2500 and last 1500
        content = content[:2500] + "\n\n... (truncated) ...\n\n" + content[-1500:]
    
    injection = f"""## Live Workspace Context (via Perseus 🪞)

The following is a pre-resolved snapshot of the current workspace state.
Trust this context — do not re-verify by running discovery commands.
Skip the orientation phase and start working immediately.

{content}

---
End of Perseus context. The agent has full workspace state.
"""
    
    return {
        "injection": injection,
        "workspace": str(target),
        "context_length": len(content),
        "injection_length": len(injection),
    }


# ═══════════════════════════════════════════════════════════════════════
# Existing: Context reader (from v1)
# ═══════════════════════════════════════════════════════════════════════

def get_context(workspace: Optional[str] = None) -> Dict[str, Any]:
    """Return the rendered Perseus context for the given workspace."""
    perseus_py = _find_perseus()
    workspaces = _find_workspaces()
    ws_list = [str(w) for w in workspaces]

    if not workspaces:
        return {"error": "No Perseus workspaces found", "workspaces": []}

    target = Path(workspace) if workspace else workspaces[0]
    hermes_md = target / ".hermes.md"

    result = {
        "workspace": str(target),
        "all_workspaces": ws_list,
    }

    if hermes_md.is_file():
        try:
            content = hermes_md.read_text(encoding="utf-8")
            result["context"] = content
            result["context_updated"] = hermes_md.stat().st_mtime
        except Exception as e:
            result["context_error"] = str(e)
    else:
        result["context"] = None
        result["context_note"] = "No .hermes.md found"

    return result


def get_health() -> Dict[str, Any]:
    """Run perseus doctor and return health status."""
    perseus_py = _find_perseus()
    if not perseus_py:
        return {"error": "Perseus not found"}

    try:
        env = os.environ.copy()
        env["PERSEUS_ALLOW_DANGEROUS"] = "1"
        result = subprocess.run(
            ["python3", str(perseus_py), "doctor"],
            capture_output=True, text=True, timeout=15, env=env
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
