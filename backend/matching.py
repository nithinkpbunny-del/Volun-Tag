import re

from sentence_transformers import SentenceTransformer


# ─── AI Matching Model ─────────────────────────────────────────────
model = SentenceTransformer("all-MiniLM-L6-v2")


# ─── Category keywords for weighted matching ───────────────────────
CATEGORY_KEYWORDS = {
    "Education": [
        "teaching",
        "tutoring",
        "mentoring",
        "curriculum",
        "literacy",
        "school",
        "education",
        "learning",
        "academic",
        "student",
        "instructor",
    ],
    "Health": [
        "medical",
        "nursing",
        "health",
        "wellness",
        "therapy",
        "first aid",
        "mental health",
        "counseling",
        "healthcare",
        "clinical",
        "nutrition",
        "fitness",
        "paramedic",
        "emergency medical",
        "public health",
    ],
    "Environment": [
        "conservation",
        "recycling",
        "sustainability",
        "ecology",
        "wildlife",
        "climate",
        "green",
        "environmental",
        "nature",
        "cleanup",
        "reforestation",
        "pollution",
    ],
    "Animal Welfare": [
        "animal",
        "pet",
        "veterinary",
        "wildlife",
        "adoption",
        "foster",
        "canine",
        "feline",
        "habitat",
        "species",
    ],
    "Social Services": [
        "outreach",
        "welfare",
        "advocacy",
        "housing",
        "food bank",
        "poverty",
        "homeless",
        "elderly",
        "disability",
        "disaster",
        "relief",
        "crisis",
        "emergency",
        "flood",
        "displaced",
        "humanitarian",
        "refugee",
    ],
}

CATEGORY_BOOST = 0.15
LOCATION_BOOST = 0.10
MATCH_HIGH_MIN = 0.45
MATCH_MEDIUM_MIN = 0.30


# ─── Helpers ───────────────────────────────────────────────────────
def compute_category_boost(
    skills_text: str,
    category: str,
) -> float:
    """Return a boost score if volunteer skills match NGO category keywords."""

    if not category or category not in CATEGORY_KEYWORDS:
        return 0.0

    keywords = CATEGORY_KEYWORDS[category]
    skills_lower = skills_text.lower()

    matches = sum(
        1
        for kw in keywords
        if re.search(r"\b" + re.escape(kw) + r"\b", skills_lower)
    )

    if matches == 0:
        return 0.0

    return min(matches / 3.0, 1.0) * CATEGORY_BOOST


def classify_confidence(score: float) -> str:
    """Classify match score into confidence tiers."""

    if score >= 0.70:
        return "high"

    if score >= 0.50:
        return "medium"

    return "low"


def compute_location_boost(
    volunteer_location: str,
    ngo_location: str,
) -> float:
    """Return LOCATION_BOOST when both locations are in the same city.

    The city is the text before the first comma, compared case-insensitively.
    Returns 0.0 if either location is missing or empty.
    """

    if not volunteer_location or not ngo_location:
        return 0.0

    vol_city = volunteer_location.split(",")[0].strip().lower()
    ngo_city = ngo_location.split(",")[0].strip().lower()

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
