from __future__ import annotations

import getpass
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
SKIP_PARTS = {".git", ".venv", "node_modules", "dist", "build", "data", "output", ".playwright-cli", "__pycache__"}
TEXT_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".mjs", ".json", ".md", ".yml", ".yaml", ".txt", ".example"}
SECRET_PATTERNS = {
    "API key": re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"),
    "private email": re.compile(r"\b\d{6,}@(?:qq|163|126)\.com\b", re.IGNORECASE),
    "local username": re.compile(rf"\b{re.escape(getpass.getuser())}\b", re.IGNORECASE),
}
FORBIDDEN_PATHS = {
    ROOT / "backend" / "scripts" / "seed_family_safety_details.py",
    ROOT / "src" / "components" / "family" / "FamilySafetyPage.tsx",
}
FORBIDDEN_SOURCE_TOKENS = {
    "FamilySafety": "family reserve frontend/model token",
    "family_safety": "family reserve database token",
    "family-safety": "family reserve API token",
    "家庭安全垫": "family reserve display text",
}


def main() -> None:
    failures: list[str] = []
    for path in FORBIDDEN_PATHS:
        if path.exists():
            failures.append(f"personal seed file present: {path.relative_to(ROOT)}")

    report_dir = ROOT / "backend" / "reports" / "daily"
    if report_dir.exists() and any(item.is_file() for item in report_dir.rglob("*")):
        failures.append("personal generated reports are present under backend/reports/daily")

    for path in ROOT.rglob("*"):
        if not path.is_file() or any(part in SKIP_PARTS for part in path.parts):
            continue
        if path.resolve() == Path(__file__).resolve():
            continue
        if path.suffix.lower() not in TEXT_SUFFIXES and path.name != ".env.example":
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for label, pattern in SECRET_PATTERNS.items():
            if pattern.search(content):
                failures.append(f"{label} detected in {path.relative_to(ROOT)}")
        for token, label in FORBIDDEN_SOURCE_TOKENS.items():
            if token in content:
                failures.append(f"{label} detected in {path.relative_to(ROOT)}")

    if failures:
        raise SystemExit("Release safety check failed:\n- " + "\n- ".join(failures))
    print("Release safety check passed")


if __name__ == "__main__":
    main()
