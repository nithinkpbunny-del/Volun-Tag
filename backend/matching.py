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
