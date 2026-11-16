"""Calibrate the "photo and description must match" gate of POST /report-issue.

Run on a COPY of the data (never the real backend/voluntag.db):

    DATA_DIR=/path/to/copy SEED_DEMO_DATA=false \
        ../../.venv/bin/python calibrate.py [--json out.json]

from this folder. DATA_DIR must contain voluntag.db and uploads/.

Positive pairs: every stored issue photo with its own description, and every
NGO "before" proof photo with the description of the issue it solved.
Negative pairs: every one of those photos with every OTHER issue's
description. Some "other" descriptions describe a similar problem (two
waste dumps, two health complaints), so a few negatives are not clear
mismatches; they are flagged as "related" when the two issues' stored
scene category or top recommended NGO category is the same.

Prints the CLIP score distribution of each group and, for candidate
thresholds, the false-reject rate (positives below) and the false-accept
rate (negatives at or above).
"""

import argparse
import json
import os
import sqlite3
import statistics
import sys
from pathlib import Path

sys.dont_write_bytecode = True
BACKEND = Path(__file__).resolve().parents[2] / "backend"
sys.path.insert(0, str(BACKEND))

if not os.environ.get("DATA_DIR"):
    sys.exit("Set DATA_DIR to a COPY of the data folder.")
if Path(os.environ["DATA_DIR"]).resolve() == BACKEND.resolve():
    sys.exit("Refusing to run on the real backend folder; use a copy.")

import issue_ai_pipeline as pipe  # noqa: E402
import settings  # noqa: E402


def top_category(recs):
    try:
        recs = json.loads(recs or "[]")
        return recs[0].get("ngo_category") if recs else None
    except ValueError:
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", help="write raw scores here")
    args = parser.parse_args()

    con = sqlite3.connect(settings.DATABASE_PATH)
    con.row_factory = sqlite3.Row
    issues = {
        r["complaint_id"]: r
        for r in con.execute(
            "select complaint_id, user_description, image_paths, ai_scene_category, "
            "recommended_ngos from issues"
        )
    }

    photos = []  # (path, owning complaint id, source)
    for cid, row in issues.items():
        for name in json.loads(row["image_paths"] or "[]") or []:
            photos.append((settings.UPLOAD_DIR / name, cid, "issue photo"))
    for r in con.execute("select complaint_id, before_photo from issue_resolutions"):
        if r["complaint_id"] in issues:
            photos.append((settings.RESOLUTIONS_UPLOAD_DIR / r["before_photo"], r["complaint_id"], "before photo"))

    def related(a, b):
        ia, ib = issues[a], issues[b]
        same_scene = ia["ai_scene_category"] and ia["ai_scene_category"] == ib["ai_scene_category"]
        ta, tb = top_category(ia["recommended_ngos"]), top_category(ib["recommended_ngos"])
        return bool(same_scene or (ta and ta == tb))

    rows = []
    for path, owner, source in photos:
        if not path.is_file():
            print("missing", path.name)
            continue
        for cid, issue in issues.items():
            analysis = pipe.analyse_images([path.name], issue["user_description"], base_dir=path.parent, caption=False)
            if not analysis.similarities:
                continue
            rows.append({
                "photo": path.name, "source": source, "owner": owner, "description_of": cid,
                "positive": cid == owner,
                "related": cid != owner and related(owner, cid),
                "score": round(analysis.similarities[0], 4),
                "description": issue["user_description"][:70],
            })

    pos = [r["score"] for r in rows if r["positive"]]
    neg = [r["score"] for r in rows if not r["positive"]]
    neg_clear = [r["score"] for r in rows if not r["positive"] and not r["related"]]

    def describe(name, xs):
        xs = sorted(xs)
        q = statistics.quantiles(xs, n=10) if len(xs) >= 2 else xs
        print(f"{name:<22} n={len(xs):<4} min={xs[0]:.3f} p10={q[0]:.3f} median={statistics.median(xs):.3f} "
              f"p90={q[-1]:.3f} max={xs[-1]:.3f}")

    print(f"photos: {len(photos)}  issues: {len(issues)}  pairs: {len(rows)}")
    describe("positives", pos)
    describe("negatives (all)", neg)
    describe("negatives (clear)", neg_clear)

    print("\nthreshold  false-reject(pos<t)  false-accept(all neg>=t)  false-accept(clear neg>=t)")
    for t in [x / 100 for x in range(14, 31)]:
        fr = sum(s < t for s in pos) / len(pos)
        fa = sum(s >= t for s in neg) / len(neg)
        fc = sum(s >= t for s in neg_clear) / max(1, len(neg_clear))
        print(f"  {t:.2f}        {fr:6.1%}               {fa:6.1%}                  {fc:6.1%}")

    print("\nlowest positives:")
    for r in sorted((r for r in rows if r["positive"]), key=lambda r: r["score"])[:5]:
        print(f"  {r['score']:.3f} {r['source']:<12} {r['description']}")
    print("highest negatives:")
    for r in sorted((r for r in rows if not r["positive"]), key=lambda r: -r["score"])[:8]:
        tag = "related" if r["related"] else "clear"
        print(f"  {r['score']:.3f} {tag:<7} photo of {r['owner']} vs '{r['description']}'")

    if args.json:
        Path(args.json).write_text(json.dumps(rows, indent=1))


if __name__ == "__main__":
    main()
