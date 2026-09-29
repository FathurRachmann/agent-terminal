#!/usr/bin/env python3
"""stdin JSON {state, questions} → stdout JSON {ok, answers, routing}.

Requires: pip install laya
Falls back to ok=false when laya is missing so the Node client can use heuristics.
"""
from __future__ import annotations

import json
import sys


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception as exc:  # noqa: BLE001
        json.dump({"ok": False, "error": f"invalid json: {exc}"}, sys.stdout)
        return 1

    state = payload.get("state")
    questions = payload.get("questions") or {}
    if not isinstance(questions, dict) or not questions:
        json.dump({"ok": False, "error": "questions required"}, sys.stdout)
        return 1

    try:
        from laya import Router  # type: ignore
    except Exception as exc:  # noqa: BLE001
        json.dump(
            {
                "ok": False,
                "error": f"laya not installed: {exc}",
                "hint": "pip install laya",
            },
            sys.stdout,
        )
        return 2

    try:
        router = Router(preload=False)
        res = router.predict(state, questions)
        answers = res.get("answers") if isinstance(res, dict) else None
        routing = res.get("routing") if isinstance(res, dict) else None
        if not answers:
            json.dump({"ok": False, "error": "empty answers"}, sys.stdout)
            return 3
        json.dump({"ok": True, "answers": answers, "routing": routing}, sys.stdout)
        return 0
    except Exception as exc:  # noqa: BLE001
        json.dump({"ok": False, "error": str(exc)}, sys.stdout)
        return 4


if __name__ == "__main__":
    raise SystemExit(main())
