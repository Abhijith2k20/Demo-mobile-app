"""Routers only translate HTTP. Business actions live in services/, rules in rules.py, visibility
in access.py. Nothing but main.py may import a router, and routers don't import each other."""
import ast
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"


def imported_modules(path: Path) -> set[str]:
    mods = set()
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.ImportFrom) and node.module:
            mods.add(node.module)
    return mods


def test_only_main_imports_routers():
    offenders = [
        str(p.relative_to(APP))
        for p in APP.rglob("*.py")
        if p.name != "main.py" and p.parent.name != "routers" and any("routers" in m for m in imported_modules(p))
    ]
    assert offenders == []


def test_routers_do_not_import_each_other():
    names = {p.stem for p in (APP / "routers").glob("*.py")} - {"__init__"}
    offenders = {
        p.name: sorted(m for m in imported_modules(p) if m in names)
        for p in (APP / "routers").glob("*.py")
        if any(m in names for m in imported_modules(p))
    }
    assert offenders == {}
