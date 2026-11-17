"""Self-made matching evaluation (no hand labels exist).

Run on a COPY of the data (it only reads the database; vectors are computed
in memory with the real MiniLM model):

    cd backend && DATA_DIR=/path/to/copy SEED_DEMO_DATA=false \
        ../.venv/bin/python ../tools/match_eval/match_eval.py [--save baseline.json] [--compare baseline.json]

Labels. A volunteer's label is the NGO category (or categories, on a tie)
whose v1 keywords appear most often in their skills. Volunteers with no
keyword hit have no label. These labels come from the same keyword lists
the scorer uses, so the numbers are a regression guard, not a measure of
real quality: they are biased towards v1's whole-word keywords.

A. NGO ranking (the /match screen): share of labelled volunteers whose
   top-1 / any of top-3 NGOs is in their label category. This is the old
   baseline_quality.py metric (89 % / 96 % on the real data).

B. Event visibility (the /volunteer-events screen), leave-one-out: every
   OTHER volunteer's skills become an event posted by an NGO of that
   volunteer's label category, in that volunteer's city. An event is
   relevant when the two labels share a category. For each volunteer we
   rank the events their screen would show (v1: score >= 0.45 AND a
   category keyword hit; v2: score >= 0.45) and report precision@3,
   NDCG@5, the average number of events shown, and how many labelled /
   unlabelled volunteers would see no event at all.

The ratings bonus is reported separately: how many volunteers have enough
rated, attended events for it to apply.
"""

import argparse
import json
import math
import os
import sqlite3
import sys
from pathlib import Path

sys.dont_write_bytecode = True
BACKEND = Path(__file__).resolve().parents[2] / "backend"
sys.path.insert(0, str(BACKEND))

if not os.environ.get("DATA_DIR"):
    sys.exit("Set DATA_DIR to a COPY of the data folder.")
if Path(os.environ["DATA_DIR"]).resolve() == BACKEND.resolve():
    sys.exit("Refusing to run on the real backend folder; use a copy.")

import numpy as np  # noqa: E402

import matching  # noqa: E402
import settings  # noqa: E402
from matching_config import CATEGORY_KEYWORDS, MATCHABLE_NGO_STATUSES, MIN_EVENT_MATCH  # noqa: E402


def labels_for(skills):
    hits = {cat: len(matching.matched_keywords(skills, cat)) for cat in CATEGORY_KEYWORDS}
    best = max(hits.values())
    return {c for c, h in hits.items() if h == best} if best else set()


def normalise(m):
    m = np.asarray(m, dtype=np.float32)
    return m / np.maximum(np.linalg.norm(m, axis=1, keepdims=True), 1e-9)


def ndcg(rels, k):
    dcg = sum(r / math.log2(i + 2) for i, r in enumerate(rels[:k]))
    ideal = sorted(rels, reverse=True)
    idcg = sum(r / math.log2(i + 2) for i, r in enumerate(ideal[:k]))
    return dcg / idcg if idcg else 0.0


def evaluate(v2, vols, ngos, vol_vecs, ngo_vecs):
    sem_ngo = vol_vecs @ ngo_vecs.T
    sem_vol = vol_vecs @ vol_vecs.T
    labels = [labels_for(v["skills"]) for v in vols]

    # A. NGO ranking
    n = top1 = top3 = 0
    for i, v in enumerate(vols):
        if not labels[i]:
            continue
        scored = sorted(
            (
                matching.score_match(float(sem_ngo[i, j]), v["skills"], ngo["motto"] or "", ngo["category"],
                                     use_location=False, v2=v2)[0],
                ngo["category"],
            )
            for j, ngo in enumerate(ngos)
        )[::-1]
        cats = [c for _, c in scored[:3]]
        n += 1
        top1 += cats[0] in labels[i]
        top3 += any(c in labels[i] for c in cats)

    # B. Event visibility (leave-one-out)
    p3, nd5, shown_counts = [], [], []
    zero_labelled = zero_unlabelled = 0
    for i, v in enumerate(vols):
        shown = []
        for j, u in enumerate(vols):
            if i == j or not labels[j]:
                continue
            category = sorted(labels[j])[0]
            score, exp = matching.score_match(
                float(sem_vol[i, j]), v["skills"], u["skills"], category,
                v["location"], u["location"], v2=v2,
            )
            if score < MIN_EVENT_MATCH:
                continue
            if not v2 and exp["category_boost"] <= 0:
                continue
            shown.append((score, 1 if labels[i] & labels[j] else 0))
        shown.sort(reverse=True)
        shown_counts.append(len(shown))
        if not shown:
            if labels[i]:
                zero_labelled += 1
            else:
                zero_unlabelled += 1
        if labels[i]:
            rels = [r for _, r in shown]
            p3.append(sum(rels[:3]) / 3)
            nd5.append(ndcg(rels, 5) if rels else 0.0)

    return {
        "scoring": "v2" if v2 else "v1",
        "ngo_labelled_volunteers": n,
        "ngo_top1": round(top1 / n, 4),
        "ngo_top3": round(top3 / n, 4),
        "event_precision_at_3": round(float(np.mean(p3)), 4),
        "event_ndcg_at_5": round(float(np.mean(nd5)), 4),
        "events_shown_avg": round(float(np.mean(shown_counts)), 2),
        "zero_events_labelled": zero_labelled,
        "zero_events_unlabelled": zero_unlabelled,
        "unlabelled_volunteers": sum(1 for l in labels if not l),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--save")
    parser.add_argument("--compare")
    args = parser.parse_args()

    con = sqlite3.connect(f"file:{settings.DATABASE_PATH}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    vols = [dict(r) for r in con.execute(
        "select id, skills, location from volunteers where skills is not null and skills != '' order by id")]
    marks = ",".join("?" * len(MATCHABLE_NGO_STATUSES))
    ngos = [dict(r) for r in con.execute(
        f"select id, category, location, motto from ngos where verification_status in ({marks}) order by id",
        MATCHABLE_NGO_STATUSES)]
    rated = con.execute(
        "select count(*) from (select volunteer_id from activity_signups where attendance_status='attended' "
        "and rating is not null group by volunteer_id having count(*) >= ?)",
        (settings.MATCH_RATING_MIN_COUNT,),
    ).fetchone()[0]

    vol_vecs = normalise(matching.encode_texts([v["skills"] for v in vols]))
    ngo_vecs = normalise(matching.encode_texts([n["motto"] or "" for n in ngos]))

    report = {
        "volunteers": len(vols),
        "ngos": len(ngos),
        "volunteers_with_rating_bonus": rated,
        "results": [evaluate(False, vols, ngos, vol_vecs, ngo_vecs), evaluate(True, vols, ngos, vol_vecs, ngo_vecs)],
    }

    print(json.dumps(report, indent=2))

    if args.compare and Path(args.compare).exists():
        old = {r["scoring"]: r for r in json.loads(Path(args.compare).read_text())["results"]}
        print("\nchange versus", args.compare)
        for r in report["results"]:
            before = old.get(r["scoring"], {})
            for key, value in r.items():
                if key in before and before[key] != value:
                    print(f"  {r['scoring']} {key}: {before[key]} -> {value}")

    if args.save:
        Path(args.save).write_text(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
