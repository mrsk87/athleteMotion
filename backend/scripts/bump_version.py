"""Bump the application version using semantic versioning (SemVer 2.0.0).

Supports:
- Explicit bumping: python scripts/bump_version.py patch|minor|major
- Automatic detection from Git commit messages: python scripts/bump_version.py --auto
- Inspection: python scripts/bump_version.py --current
- Simulation: python scripts/bump_version.py --dry-run [patch|minor|major]
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION_FILE = ROOT / "VERSION"
PACKAGE_FILE = ROOT / "frontend" / "mediapipe" / "package.json"
PACKAGE_LOCK_FILE = ROOT / "frontend" / "mediapipe" / "package-lock.json"
SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")


def read_version() -> tuple[int, int, int]:
    """Read the current SemVer from the single source of truth."""
    if not VERSION_FILE.exists():
        raise SystemExit(f"VERSION file not found at: {VERSION_FILE}")
    version = VERSION_FILE.read_text(encoding="utf-8").strip()
    match = SEMVER.fullmatch(version)
    if not match:
        raise SystemExit(f"Invalid VERSION value: {version!r}")
    return tuple(map(int, match.groups()))


def next_version(current: tuple[int, int, int], part: str) -> str:
    """Calculate the next semantic version string."""
    major, minor, patch = current
    if part == "major":
        return f"{major + 1}.0.0"
    if part == "minor":
        return f"{major}.{minor + 1}.0"
    if part == "patch":
        return f"{major}.{minor}.{patch + 1}"
    raise ValueError(f"Unknown version increment part: {part!r}")


def detect_increment_from_git() -> str:
    """Analyze recent git commit messages to determine if major, minor, or patch is needed."""
    try:
        # Get commit message of HEAD
        result = subprocess.run(
            ["git", "log", "-1", "--pretty=%B"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=True
        )
        message = result.stdout.strip()
    except Exception as exc:
        print(f"[warning] Could not read git commit message ({exc}). Defaulting to 'patch'.", file=sys.stderr)
        return "patch"

    # Conventional commits analysis
    if "#major" in message or "BREAKING CHANGE:" in message or re.search(r"^[a-z]+(\([^\)]+\))?!:", message, re.MULTILINE):
        return "major"
    if "#minor" in message or re.search(r"^feat(\([^\)]+\))?:", message, re.MULTILINE):
        return "minor"
    return "patch"


def update_frontend(version: str) -> None:
    """Synchronize frontend package.json and package-lock.json with the new version."""
    if PACKAGE_FILE.exists():
        package = json.loads(PACKAGE_FILE.read_text(encoding="utf-8"))
        package["version"] = version
        PACKAGE_FILE.write_text(
            json.dumps(package, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    if PACKAGE_LOCK_FILE.exists():
        try:
            lock = json.loads(PACKAGE_LOCK_FILE.read_text(encoding="utf-8"))
            lock["version"] = version
            if "packages" in lock and "" in lock["packages"]:
                lock["packages"][""]["version"] = version
            PACKAGE_LOCK_FILE.write_text(
                json.dumps(lock, indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
        except Exception:
            pass


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "part",
        nargs="?",
        choices=("major", "minor", "patch"),
        help="SemVer increment part (major, minor, or patch)"
    )
    parser.add_argument(
        "--auto",
        action="store_true",
        help="Automatically determine increment from recent git commit message"
    )
    parser.add_argument(
        "--current",
        action="store_true",
        help="Print the current version and exit"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Calculate the next version without modifying files"
    )

    args = parser.parse_args()

    current_tuple = read_version()
    current_str = f"{current_tuple[0]}.{current_tuple[1]}.{current_tuple[2]}"

    if args.current:
        print(current_str)
        return

    part = args.part
    if args.auto:
        part = detect_increment_from_git()
    elif not part:
        # Default behavior if nothing passed
        part = "patch"

    new_version_str = next_version(current_tuple, part)

    if args.dry_run:
        print(f"Current version: {current_str}")
        print(f"Detected part:   {part}")
        print(f"Next version:    {new_version_str} (dry-run, no changes made)")
        return

    VERSION_FILE.write_text(new_version_str + "\n", encoding="utf-8")
    update_frontend(new_version_str)
    print(f"v{new_version_str}")


if __name__ == "__main__":
    main()
