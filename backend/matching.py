"""Volunteer matching: the shared MiniLM model and the score rules.

Scores are built from parts (all in 0..1 score units, final capped at 1):

* v1 (default, today's behaviour): semantic cosine + category keyword boost
  (whole-word hits of the NGO category's keywords, n/3 x 0.15) + same-city
  boost 0.10 where the screen uses it.
* v2 (MATCH_V2=true): the same parts, but keyword hits also accept simple
  word forms (teacher/teaching, students/student) and a skill-overlap part
  (shared skill words with the event or NGO text) is added. Volunteers can
  then see events without a category keyword hit.
* Ratings bonus (MATCH_USE_RATINGS, on by default, both versions): only for
  a volunteer with at least MATCH_RATING_MIN_COUNT rated, attended events.
  bonus = score x MATCH_RATING_MAX_BONUS x (mean rating - 1) / 4, so a 5-star
  mean adds 5 % of the score and a 1-star mean adds nothing. Below the
  minimum count it is exactly zero.

Weights and thresholds live in matching_config.py.
"""

import re
import threading
from functools import lru_cache
from typing import Optional

from sentence_transformers import SentenceTransformer

try:
    from . import settings
    from .matching_config import (
        CATEGORY_BOOST, CATEGORY_KEYWORDS, CONFIDENCE_HIGH_MIN,
        CONFIDENCE_MEDIUM_MIN, LOCATION_BOOST, MATCH_HIGH_MIN,
        MATCH_MEDIUM_MIN, SKILL_OVERLAP_BOOST, STOPWORDS,
    )
except ImportError:
    import settings
    from matching_config import (
        CATEGORY_BOOST, CATEGORY_KEYWORDS, CONFIDENCE_HIGH_MIN,
        CONFIDENCE_MEDIUM_MIN, LOCATION_BOOST, MATCH_HIGH_MIN,
        MATCH_MEDIUM_MIN, SKILL_OVERLAP_BOOST, STOPWORDS,
    )


# ─── AI Matching Model ─────────────────────────────────────────────
_model = None
_model_load_lock = threading.Lock()
# Serialises MiniLM inference only. BLIP/CLIP have their own lock in
# issue_ai_pipeline.py, so a slow photo report does not stall matching.
MODEL_LOCK = threading.Lock()


def get_model():
    """Return the shared CPU SentenceTransformer, loading it once on first call."""
    global _model
    if _model is None:
        with _model_load_lock:
            if _model is None:
                _model = SentenceTransformer("all-MiniLM-L6-v2", device="cpu")
                import torch
                torch.set_num_threads(2)
    return _model


def encode_texts(texts):
    """Encode texts with the shared model, one inference at a time."""
    with MODEL_LOCK:
        return get_model().encode(list(texts), show_progress_bar=False)


# ─── Keyword helpers ───────────────────────────────────────────────
@lru_cache(maxsize=256)
def _keyword_pattern(keyword: str):
    return re.compile(r"\b" + re.escape(keyword) + r"\b")


def matched_keywords(skills_text: str, category: str) -> list[str]:
    """v1: the category keywords found as whole words in the text."""
    if not category or category not in CATEGORY_KEYWORDS:
        return []
    text = (skills_text or "").lower()
    return [kw for kw in CATEGORY_KEYWORDS[category] if _keyword_pattern(kw).search(text)]


def compute_category_boost(
    skills_text: str,
    category: str,
) -> float:
    """Return a boost score if volunteer skills match NGO category keywords."""

    matches = len(matched_keywords(skills_text, category))

    if matches == 0:
        return 0.0

    return min(matches / 3.0, 1.0) * CATEGORY_BOOST


_WORD = re.compile(r"[a-z]+")


def stem(word: str) -> str:
    """A tiny English stemmer: teachers/teaching/teacher -> teach, nurse/nursing -> nurs."""
    word = word.lower()
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        word = word[:-1]
    for suffix in ("ing", "er", "e"):
        if word.endswith(suffix) and len(word) - len(suffix) >= 4:
            return word[: -len(suffix)]
    return word


def stem_tokens(text: str) -> list[str]:
    return [stem(w) for w in _WORD.findall((text or "").lower())]


def matched_keywords_v2(skills_text: str, category: str) -> list[str]:
    """v2: like matched_keywords, but word forms count (teacher ~ teaching)."""
    if not category or category not in CATEGORY_KEYWORDS:
        return []
    tokens = stem_tokens(skills_text)
    joined = " " + " ".join(tokens) + " "
    found = []
    for kw in CATEGORY_KEYWORDS[category]:
        kw_tokens = stem_tokens(kw)
        if kw_tokens and (" " + " ".join(kw_tokens) + " ") in joined:
            found.append(kw)
    return found


@lru_cache(maxsize=4096)
def _keywords_cached(skills_text: str, category: str, v2: bool) -> tuple:
    """Keyword hits per (text, category): computed once, not once per pair."""
    if v2:
        return tuple(matched_keywords_v2(skills_text, category))
    return tuple(matched_keywords(skills_text, category))


@lru_cache(maxsize=4096)
def _content_words(text: str) -> frozenset:
    return frozenset(t for t in stem_tokens(text) if t not in STOPWORDS and len(t) > 2)


def skill_overlap(volunteer_text: str, target_text: str) -> float:
    """Share (0..1) of the target's content words that the volunteer also has."""
    target = _content_words(target_text or "")
    if not target:
        return 0.0
    return len(target & _content_words(volunteer_text or "")) / len(target)


def classify_confidence(score: float) -> str:
    """Classify match score into confidence tiers."""

    if score >= CONFIDENCE_HIGH_MIN:
        return "high"

    if score >= CONFIDENCE_MEDIUM_MIN:
        return "medium"

    return "low"


def city_of(location: Optional[str]) -> str:
    return (location or "").split(",")[0].strip()


def compute_location_boost(
    volunteer_location: str,
    ngo_location: str,
) -> float:
    """Return LOCATION_BOOST when both locations are in the same city.

    The city is the text before the first comma, compared case-insensitively.
    Returns 0.0 if either location is missing or empty.
    """

    vol_city = city_of(volunteer_location).lower()
    ngo_city = city_of(ngo_location).lower()

    if not vol_city or not ngo_city:
        return 0.0

    return LOCATION_BOOST if vol_city == ngo_city else 0.0


def compute_match_level(
    final_score: float,
    category_boost: float,
) -> str:
    """Return "high", "medium" or "low".

    "high" needs a score of MATCH_HIGH_MIN or more AND a category keyword hit
    (category_boost above 0). A score at or above MATCH_HIGH_MIN without a
    keyword hit is "medium".
    """

    if final_score >= MATCH_HIGH_MIN and category_boost > 0:
        return "high"

    if final_score >= MATCH_MEDIUM_MIN:
        return "medium"

    return "low"


# ─── Ratings bonus ─────────────────────────────────────────────────
def rating_bonus_fraction(rated_count: int, mean_rating: Optional[float]) -> float:
    """Multiplier part (0 .. MATCH_RATING_MAX_BONUS) earned by past ratings."""
    if not settings.MATCH_USE_RATINGS or mean_rating is None:
        return 0.0
    if rated_count < settings.MATCH_RATING_MIN_COUNT:
        return 0.0
    scaled = (min(max(mean_rating, 1.0), 5.0) - 1.0) / 4.0
    return settings.MATCH_RATING_MAX_BONUS * scaled


# ─── One score, with its explanation ───────────────────────────────
def score_match(
    semantic: float,
    volunteer_skills: str,
    target_text: str,
    ngo_category: Optional[str],
    volunteer_location: Optional[str] = None,
    target_location: Optional[str] = None,
    use_location: bool = True,
    rating_stats: tuple = (0, None),
    v2: Optional[bool] = None,
) -> tuple[float, dict]:
    """Return (final score, explanation dict) for one volunteer and one target.

    The explanation has the keys of schemas.MatchExplanation. For v1 the
    final score before the ratings bonus equals today's formula exactly.
    """

    v2 = settings.MATCH_V2 if v2 is None else v2
    skills = volunteer_skills or ""

    keywords = list(_keywords_cached(skills, ngo_category or "", v2))

    category_boost = min(len(keywords) / 3.0, 1.0) * CATEGORY_BOOST if keywords else 0.0
    location_boost = (
        compute_location_boost(volunteer_location or "", target_location or "")
        if use_location else 0.0
    )
    overlap = skill_overlap(skills, target_text) * SKILL_OVERLAP_BOOST if v2 else 0.0

    base = max(0.0, min(semantic + category_boost + location_boost + overlap, 1.0))

    rated_count, mean_rating = rating_stats
    bonus = base * rating_bonus_fraction(rated_count, mean_rating)
    final = min(base + bonus, 1.0)
    bonus = final - base

    parts = []
    if keywords:
        parts.append("matched on: " + ", ".join(keywords[:4]))
    if location_boost:
        parts.append("same city: " + city_of(volunteer_location))
    if overlap:
        parts.append("shared skills with the event")
    if bonus > 0:
        parts.append(
            f"rating bonus: +{bonus * 100:.1f} points "
            f"({rated_count} rated events, average {mean_rating:.1f})"
        )
    summary = " · ".join(parts) if parts else "similar wording in skills and needs"

    explanation = {
        "semantic": round(float(semantic), 4),
        "category_boost": round(category_boost, 4),
        "location_boost": round(location_boost, 4),
        "skill_overlap": round(overlap, 4),
        "rating_bonus": round(bonus, 4),
        "matched_keywords": keywords,
        "same_city": city_of(volunteer_location) if location_boost else None,
        "rated_events": int(rated_count or 0),
        "average_rating": round(mean_rating, 2) if mean_rating is not None else None,
        "scoring": "v2" if v2 else "v1",
        "summary": summary[:1].upper() + summary[1:],
    }

    return final, explanation
