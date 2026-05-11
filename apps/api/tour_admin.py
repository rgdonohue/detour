#!/usr/bin/env python3
"""Admin CLI for managing saved user tours on disk.

Reads SAVED_TOURS_DIR from the environment (same as the API), so running
this inside a Railway container shell operates on the live Volume.

  python tour_admin.py list [--older-than DAYS] [--mode walk|drive] [--limit N] [--json]
  python tour_admin.py stats
  python tour_admin.py rm SLUG [--yes]
  python tour_admin.py prune --older-than DAYS [--dry-run] [--yes]

`prune` deletes in bulk; `rm` is a single-slug surgical remove. Both
require either an interactive 'y' confirmation or --yes.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path

# Share the same path resolution and slug validation as the API writer.
from saved_tours import _SAVED_DIR, _SLUG_RE


@dataclass
class TourFile:
    slug: str
    path: Path
    size: int
    mtime: float
    name: str
    mode: str
    stop_count: int

    @property
    def age_days(self) -> float:
        return (time.time() - self.mtime) / 86400


def _read_tour(path: Path) -> TourFile | None:
    """Load a tour JSON and pull out the fields we care about. Skips files
    that don't parse — corrupted writes shouldn't break the whole listing."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"warn: skipping unreadable {path.name}: {e}", file=sys.stderr)
        return None
    return TourFile(
        slug=path.stem,
        path=path,
        size=path.stat().st_size,
        mtime=path.stat().st_mtime,
        name=str(data.get("name", "")),
        mode=str(data.get("mode", "")),
        stop_count=int(data.get("stop_count", len(data.get("stops", []) or []))),
    )


def _collect(
    *,
    older_than_days: float | None = None,
    mode: str | None = None,
) -> list[TourFile]:
    tours: list[TourFile] = []
    for path in sorted(_SAVED_DIR.glob("*.json")):
        if path.name.startswith("."):
            continue
        t = _read_tour(path)
        if t is None:
            continue
        if older_than_days is not None and t.age_days < older_than_days:
            continue
        if mode is not None and t.mode != mode:
            continue
        tours.append(t)
    return tours


def _format_size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.0f}{unit}" if unit == "B" else f"{n:.1f}{unit}"
        n /= 1024
    return f"{n:.1f}TB"


def _format_age(days: float) -> str:
    if days < 1:
        return f"{days * 24:.0f}h"
    if days < 30:
        return f"{days:.0f}d"
    if days < 365:
        return f"{days / 30:.0f}mo"
    return f"{days / 365:.1f}y"


def cmd_list(args: argparse.Namespace) -> int:
    tours = _collect(older_than_days=args.older_than, mode=args.mode)
    if args.limit:
        tours = tours[: args.limit]

    if args.json:
        out = [
            {
                "slug": t.slug,
                "name": t.name,
                "mode": t.mode,
                "stops": t.stop_count,
                "size": t.size,
                "mtime": t.mtime,
                "age_days": round(t.age_days, 2),
            }
            for t in tours
        ]
        print(json.dumps(out, indent=2))
        return 0

    if not tours:
        print(f"(no tours in {_SAVED_DIR})")
        return 0

    # Compact, fixed-width table — no rich/tabulate dependency.
    print(f"{'slug':<12} {'mode':<5} {'stops':>5} {'size':>7} {'age':>5}  name")
    print("-" * 60)
    for t in tours:
        name = t.name if len(t.name) <= 30 else t.name[:27] + "..."
        print(
            f"{t.slug:<12} {t.mode:<5} {t.stop_count:>5} "
            f"{_format_size(t.size):>7} {_format_age(t.age_days):>5}  {name}"
        )
    print(f"\n{len(tours)} tour(s)")
    return 0


def cmd_stats(args: argparse.Namespace) -> int:
    tours = _collect()
    if not tours:
        print(f"No tours in {_SAVED_DIR}")
        return 0

    total_bytes = sum(t.size for t in tours)
    by_mode: dict[str, int] = {}
    for t in tours:
        by_mode[t.mode or "?"] = by_mode.get(t.mode or "?", 0) + 1
    oldest = min(tours, key=lambda t: t.mtime)
    newest = max(tours, key=lambda t: t.mtime)

    print(f"Directory:   {_SAVED_DIR}")
    print(f"Total tours: {len(tours)}")
    print(f"Total size:  {_format_size(total_bytes)}")
    print(f"By mode:     " + ", ".join(f"{m}={c}" for m, c in sorted(by_mode.items())))
    print(f"Oldest:      {oldest.slug}  ({_format_age(oldest.age_days)} ago)")
    print(f"Newest:      {newest.slug}  ({_format_age(newest.age_days)} ago)")
    return 0


def _confirm(prompt: str, assume_yes: bool) -> bool:
    if assume_yes:
        return True
    if not sys.stdin.isatty():
        print("error: refusing to delete without --yes in non-interactive mode", file=sys.stderr)
        return False
    resp = input(f"{prompt} [y/N] ").strip().lower()
    return resp in ("y", "yes")


def cmd_rm(args: argparse.Namespace) -> int:
    slug = args.slug
    if not _SLUG_RE.match(slug):
        print(f"error: invalid slug shape: {slug!r}", file=sys.stderr)
        return 2
    path = _SAVED_DIR / f"{slug}.json"
    if not path.is_file():
        print(f"error: no such tour: {slug}", file=sys.stderr)
        return 1
    t = _read_tour(path)
    label = f"{slug}  {t.name!r}  ({_format_age(t.age_days)} ago)" if t else slug
    if not _confirm(f"Delete {label}?", args.yes):
        print("aborted")
        return 1
    path.unlink()
    print(f"deleted {slug}")
    return 0


def cmd_prune(args: argparse.Namespace) -> int:
    if args.older_than is None:
        print("error: --older-than is required for prune", file=sys.stderr)
        return 2
    targets = _collect(older_than_days=args.older_than, mode=args.mode)
    if not targets:
        print(f"No tours older than {args.older_than} days.")
        return 0
    total_bytes = sum(t.size for t in targets)
    print(
        f"Found {len(targets)} tour(s) older than {args.older_than} days "
        f"({_format_size(total_bytes)})."
    )
    for t in targets[:10]:
        print(f"  {t.slug}  {_format_age(t.age_days)}  {t.name[:40]}")
    if len(targets) > 10:
        print(f"  … and {len(targets) - 10} more")

    if args.dry_run:
        print("(dry run — no files deleted)")
        return 0
    if not _confirm(f"Delete {len(targets)} tour(s)?", args.yes):
        print("aborted")
        return 1
    for t in targets:
        t.path.unlink()
    print(f"deleted {len(targets)} tour(s)")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="tour_admin", description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)

    p_list = sub.add_parser("list", help="List saved tours")
    p_list.add_argument("--older-than", type=float, metavar="DAYS",
                        help="Only show tours older than DAYS days")
    p_list.add_argument("--mode", choices=("walk", "drive"))
    p_list.add_argument("--limit", type=int, metavar="N")
    p_list.add_argument("--json", action="store_true", help="Output JSON instead of a table")
    p_list.set_defaults(func=cmd_list)

    p_stats = sub.add_parser("stats", help="Aggregate stats")
    p_stats.set_defaults(func=cmd_stats)

    p_rm = sub.add_parser("rm", help="Delete one tour by slug")
    p_rm.add_argument("slug")
    p_rm.add_argument("--yes", "-y", action="store_true", help="Skip confirmation")
    p_rm.set_defaults(func=cmd_rm)

    p_prune = sub.add_parser("prune", help="Delete all tours older than N days")
    p_prune.add_argument("--older-than", type=float, required=True, metavar="DAYS")
    p_prune.add_argument("--mode", choices=("walk", "drive"))
    p_prune.add_argument("--dry-run", action="store_true")
    p_prune.add_argument("--yes", "-y", action="store_true", help="Skip confirmation")
    p_prune.set_defaults(func=cmd_prune)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
