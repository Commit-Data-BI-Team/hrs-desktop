from __future__ import annotations

import sys

def main() -> int:
    if len(sys.argv) == 2 and sys.argv[1] == "--runtime-version":
        print("hrs-python-runtime-v1")
        return 0
    if len(sys.argv) < 2 or sys.argv[1] not in {"agenda_fetch", "meetings_fetch"}:
        print(
            "Usage: hrs-python-runtime <agenda_fetch, meetings_fetch> [arguments]",
            file=sys.stderr,
        )
        return 2
    entrypoint = sys.argv.pop(1)
    if entrypoint == "agenda_fetch":
        from agenda_fetch import main as entrypoint_main
    else:
        from meetings_fetch import main as entrypoint_main
    result = entrypoint_main()
    return int(result or 0)


if __name__ == "__main__":
    raise SystemExit(main())
