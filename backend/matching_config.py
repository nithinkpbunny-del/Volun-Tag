"""One place for every matching keyword, weight and threshold.

matching.py (volunteers <-> NGOs and events) and issue_ai_pipeline.py
(reported problems -> NGOs) both read from here. The two keyword lists are
kept separate on purpose: they were tuned for different texts (volunteer
skills vs. problem descriptions), and merging them would change scores.
"""

# ─── Volunteer <-> NGO / event keywords (by NGO category) ─────────
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

# ─── Reported problem -> NGO keywords (by NGO category) ───────────
ISSUE_CATEGORY_KEYWORDS: dict[str, list[str]] = {
    "Education": [
        "teaching", "tutoring", "mentoring", "training", "curriculum",
        "literacy", "school", "education", "learning", "academic",
        "student", "instructor",
    ],
    "Health": [
        "medical", "nursing", "health", "wellness", "therapy", "first aid",
        "mental health", "counseling", "healthcare", "clinical",
        "nutrition", "fitness",
    ],
    "Environment": [
        "conservation", "recycling", "sustainability", "ecology", "wildlife",
        "climate", "green", "environmental", "nature", "cleanup",
        "reforestation", "pollution",
    ],
    "Animal Welfare": [
        "animal", "pet", "shelter", "veterinary", "rescue", "wildlife",
        "adoption", "foster", "canine", "feline", "habitat", "species",
    ],
    "Social Services": [
        "community", "outreach", "support", "welfare", "advocacy", "housing",
        "food bank", "poverty", "homeless", "elderly", "youth", "disability",
    ],
}

# NGO verification states that take part in matching.
MATCHABLE_NGO_STATUSES = ("Approved", "Pending")

# ─── Score parts (score units, 0 to 1) ────────────────────────────
CATEGORY_BOOST = 0.15        # max boost for category keywords (n hits / 3)
LOCATION_BOOST = 0.10        # same city (text before the first comma)
SKILL_OVERLAP_BOOST = 0.15   # v2 only: shared skill words with the target

# ─── Thresholds ───────────────────────────────────────────────────
# Dashboard match level (volunteer matches list).
MATCH_HIGH_MIN = 0.45
MATCH_MEDIUM_MIN = 0.30
# Confidence tiers used by /match and the issue pipeline.
CONFIDENCE_HIGH_MIN = 0.70
CONFIDENCE_MEDIUM_MIN = 0.50
# A volunteer sees an event only at or above this final score.
MIN_EVENT_MATCH = 0.45
# Issue pipeline: keep the top N NGOs plus every NGO at or above this score.
ISSUE_TOP_N = 3
MIN_ISSUE_MATCH = 0.45

# Words ignored when comparing skill texts (v2 skill overlap).
STOPWORDS = frozenset(
    "a an and are as at be by for from in into is of on or our the their to "
    "with within without we you your all any other others etc support "
    "help helping work working based local community communities".split()
)
