"""AI pipeline for processing reported issues and recommending relevant NGOs.

This module is self-contained — it does NOT import from main.py to avoid
circular dependencies.  It mirrors the same category-boost logic and
confidence thresholds used in the volunteer-NGO matching route.

Image understanding (BLIP captioning + CLIP category detection) is performed
when images are attached.  BLIP/CLIP models are lazy-loaded only on first
use.

Usage (by the caller)::

    result = process_issue(issue, db)
    issue.merged_problem_description    = result["merged_problem_description"]
    issue.recommended_ngos              = result["recommended_ngos"]
    issue.recommendation_explanations   = result["recommendation_explanations"]
    issue.ai_image_caption              = result["ai_image_caption"]
    issue.ai_scene_category             = result["ai_scene_category"]
    db.commit()
"""

from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Optional

import numpy as np
from sklearn.metrics.pairwise import cosine_similarity
from sqlalchemy.orm import Session

try:
    from .db_models import IssueDB, NGODB
    from .embedding_store import get_vectors
    from .matching import MODEL_LOCK, encode_texts
except ImportError:
    from db_models import IssueDB, NGODB
    from embedding_store import get_vectors
    from matching import MODEL_LOCK, encode_texts


logger = logging.getLogger(__name__)

# ─── Upload directory (resolved relative to this file) ──────────────

UPLOAD_DIR = Path(__file__).resolve().parent / "uploads"


# ─── Model singletons (lazy-loaded) ────────────────────────────────

# BLIP and CLIP are loaded only when an issue actually has images.
_blip_processor = None
_blip_model = None
_blip_load_lock = threading.Lock()
_clip_processor = None
_clip_model = None
_clip_load_lock = threading.Lock()


def _get_blip():
    """Return (processor, model) for BLIP image captioning, loading once."""
    global _blip_processor, _blip_model
    if _blip_processor is None:
        with _blip_load_lock:
            if _blip_processor is None:
                from transformers import BlipProcessor, BlipForConditionalGeneration
                logger.info("Loading BLIP model for image captioning...")
                processor = BlipProcessor.from_pretrained(
                    "Salesforce/blip-image-captioning-base",
                )
                model = BlipForConditionalGeneration.from_pretrained(
                    "Salesforce/blip-image-captioning-base",
                ).to("cpu")
                model.eval()
                _blip_model = model
                _blip_processor = processor
                logger.info("BLIP model loaded.")
    return _blip_processor, _blip_model


def _get_clip():
    """Return (processor, model) for CLIP zero-shot classification, loading once."""
    global _clip_processor, _clip_model
    if _clip_processor is None:
        with _clip_load_lock:
            if _clip_processor is None:
                from transformers import CLIPProcessor, CLIPModel
                logger.info("Loading CLIP model for image classification...")
                processor = CLIPProcessor.from_pretrained(
                    "openai/clip-vit-base-patch32",
                )
                model = CLIPModel.from_pretrained(
                    "openai/clip-vit-base-patch32",
                ).to("cpu")
                model.eval()
                _clip_model = model
                _clip_processor = processor
                logger.info("CLIP model loaded.")
    return _clip_processor, _clip_model


# ─── Category keywords (mirrors main.py, kept local to avoid import) ─

CATEGORY_KEYWORDS: dict[str, list[str]] = {
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

CATEGORY_LABELS = list(CATEGORY_KEYWORDS.keys())

CATEGORY_BOOST = 0.15
TOP_N = 3


# ─── Helpers ────────────────────────────────────────────────────────

def _classify_confidence(score: float) -> str:
    """Same thresholds as the volunteer-NGO matcher."""
    if score >= 0.70:
        return "high"
    if score >= 0.50:
        return "medium"
    return "low"


def _compute_category_boost(issue_text: str, category: str) -> float:
    """Return a score boost when the issue text contains category keywords."""
    if not category or category not in CATEGORY_KEYWORDS:
        return 0.0
    keywords = CATEGORY_KEYWORDS[category]
    text_lower = issue_text.lower()
    matches = sum(1 for kw in keywords if kw in text_lower)
    if matches == 0:
        return 0.0
    return min(matches / 3.0, 1.0) * CATEGORY_BOOST


# ─── Image understanding ───────────────────────────────────────────

def _caption_image(image) -> Optional[str]:
    """Generate a BLIP caption for a PIL Image.  Returns None on failure."""
    try:
        import torch
        processor, model = _get_blip()
        inputs = processor(images=image, return_tensors="pt")
        with MODEL_LOCK, torch.no_grad():
            output = model.generate(**inputs, max_new_tokens=50)
        caption = processor.decode(output[0], skip_special_tokens=True).strip()
        return caption if caption else None
    except Exception:
        logger.exception("BLIP captioning failed for an image")
        return None


def _classify_image_category(image) -> Optional[str]:
    """Use CLIP zero-shot to pick the best VolunTag category for a PIL Image."""
    try:
        import torch
        processor, model = _get_clip()
        text_labels = [f"a photo related to {cat}" for cat in CATEGORY_LABELS]
        inputs = processor(
            text=text_labels, images=image, return_tensors="pt", padding=True,
        )
        with MODEL_LOCK, torch.no_grad():
            outputs = model(**inputs)
        # logits_per_image shape: (1, num_labels)
        probs = outputs.logits_per_image.softmax(dim=1)[0]
        best_idx = int(torch.argmax(probs))
        return CATEGORY_LABELS[best_idx]
    except Exception:
        logger.exception("CLIP classification failed for an image")
        return None


def _process_images(image_paths: list[str]) -> tuple[Optional[str], Optional[str]]:
    """Process uploaded images and return (combined_caption, best_category).

    Each image is opened and run through BLIP + CLIP independently.
    Failures on individual images are skipped gracefully.
    """
    from PIL import Image

    captions: list[str] = []
    categories: list[str] = []

    for filename in image_paths:
        filepath = UPLOAD_DIR / filename
        if not filepath.is_file():
            logger.warning("Image file not found, skipping: %s", filepath)
            continue

        try:
            img = Image.open(filepath).convert("RGB")
        except Exception:
            logger.exception("Could not open image, skipping: %s", filepath)
            continue

        caption = _caption_image(img)
        if caption:
            captions.append(caption)

        category = _classify_image_category(img)
        if category:
            categories.append(category)

    combined_caption = "; ".join(captions) if captions else None

    # Pick the most frequently detected category across all images.
    best_category: Optional[str] = None
    if categories:
        from collections import Counter
        counter = Counter(categories)
        best_category = counter.most_common(1)[0][0]

    return combined_caption, best_category


# ─── Issue text builder ─────────────────────────────────────────────

def _build_issue_text(
    issue: IssueDB,
    ai_caption: Optional[str] = None,
    ai_category: Optional[str] = None,
) -> str:
    """Combine user description, image insights, and location into a single
    text block used for both ``merged_problem_description`` and NGO matching.
    """
    parts: list[str] = []
    if issue.user_description and issue.user_description.strip():
        parts.append(issue.user_description.strip())
    if ai_caption:
        parts.append(f"Image context: {ai_caption}")
    if ai_category:
        parts.append(f"Detected category: {ai_category}")
    if issue.location and issue.location.strip():
        parts.append(f"Location: {issue.location.strip()}")
    return " ".join(parts)


def _generate_explanation(
    ngo_name: str,
    ngo_category: str,
    ngo_motto: str,
    confidence: str,
    percentage: float,
    issue_text: str,
) -> str:
    """Build a deterministic, fact-based explanation for a recommendation.

    The explanation only references information present in the NGO record
    and the issue description — it never invents facts.
    """
    # Determine how many category keywords match the issue
    category_label = ngo_category or "General"
    category_keywords_matched: list[str] = []
    if ngo_category and ngo_category in CATEGORY_KEYWORDS:
        issue_lower = issue_text.lower()
        category_keywords_matched = [
            kw for kw in CATEGORY_KEYWORDS[ngo_category] if kw in issue_lower
        ]

    # Strength descriptor
    if confidence == "high":
        strength = "a strong match"
    elif confidence == "medium":
        strength = "a moderate match"
    else:
        strength = "a potential match"

    # Opening sentence
    explanation = (
        f"{ngo_name} is {strength} ({percentage}%) for this reported issue."
    )

    # Category relevance sentence
    if category_keywords_matched:
        kw_display = ", ".join(category_keywords_matched[:4])
        explanation += (
            f" The NGO operates in the {category_label} sector, which aligns"
            f" with themes in the report such as {kw_display}."
        )
    elif ngo_category:
        explanation += (
            f" The NGO focuses on {category_label}."
        )

    # Motto summary sentence
    if ngo_motto:
        # Take the first sentence (up to ~120 chars) of the motto
        motto_preview = ngo_motto.strip()
        if len(motto_preview) > 120:
            motto_preview = motto_preview[:117].rsplit(" ", 1)[0] + "..."
        explanation += f" Their stated need: \"{motto_preview}\""

    return explanation


# ─── Main pipeline ──────────────────────────────────────────────────

def process_issue(issue: IssueDB, db: Session) -> dict:
    """Analyse a reported issue and recommend the top NGOs.

    Parameters
    ----------
    issue : IssueDB
        A persisted issue record.  ``user_description``, ``location``,
        and ``image_paths`` are read.
    db : Session
        An open SQLAlchemy session (used to query NGOs).

    Returns
    -------
    dict
        ``merged_problem_description`` – the combined issue text used for
        matching (includes image captions and detected category when
        available).
        ``recommended_ngos`` – list of up to 3 recommendation dicts, each
        containing: ngo, ngo_category, ngo_motto, score, percentage,
        confidence.
        ``recommendation_explanations`` – parallel list of explanation
        strings.
        ``ai_image_caption`` – BLIP-generated caption(s) or None.
        ``ai_scene_category`` – CLIP-detected category or None.

    Notes
    -----
    This function does **not** commit or modify the database.  The caller
    is responsible for writing the returned data back to the issue record
    and committing.
    """
    empty_result: dict = {
        "merged_problem_description": None,
        "recommended_ngos": [],
        "recommendation_explanations": [],
        "ai_image_caption": None,
        "ai_scene_category": None,
    }

    # 1. Process images (if any)
    ai_caption: Optional[str] = None
    ai_category: Optional[str] = None

    if issue.image_paths and isinstance(issue.image_paths, list) and len(issue.image_paths) > 0:
        try:
            ai_caption, ai_category = _process_images(issue.image_paths)
        except Exception:
            logger.exception(
                "Image processing failed entirely for issue %s; "
                "continuing with text-only matching.",
                getattr(issue, "complaint_id", "?"),
            )

    # 2. Build issue text (enriched with image insights when available)
    issue_text = _build_issue_text(issue, ai_caption, ai_category)
    if not issue_text:
        return empty_result

    # 3. Load NGOs
    ngos = db.query(NGODB).order_by(NGODB.id).all()
    if not ngos:
        return {
            **empty_result,
            "merged_problem_description": issue_text,
            "ai_image_caption": ai_caption,
            "ai_scene_category": ai_category,
        }

    # 4. Generate embeddings
    issue_embedding = encode_texts([issue_text])       # shape (1, dim)
    ngo_embeddings = get_vectors(                       # shape (N, dim)
        db,
        [("ngo_motto_raw", ngo.id, ngo.motto or "") for ngo in ngos],
    )

    # 5. Cosine similarity → 1-D array of scores
    raw_scores = cosine_similarity(issue_embedding, ngo_embeddings)[0]

    # 6. Apply category boost
    boosted_scores = np.array([
        min(float(raw_scores[j]) + _compute_category_boost(issue_text, ngo.category), 1.0)
        for j, ngo in enumerate(ngos)
    ])

    # 7. Rank and select top-N
    top_count = min(TOP_N, len(ngos))
    top_indices = np.argsort(boosted_scores)[::-1][:top_count]

    # 8. Build recommendation list
    recommended_ngos: list[dict] = []
    recommendation_explanations: list[str] = []

    for idx in top_indices:
        ngo = ngos[idx]
        score = float(boosted_scores[idx])
        percentage = round(score * 100, 1)
        confidence = _classify_confidence(score)

        recommended_ngos.append({
            "ngo": ngo.name,
            "ngo_category": ngo.category or "Uncategorized",
            "ngo_motto": ngo.motto,
            "score": round(score, 4),
            "percentage": percentage,
            "confidence": confidence,
        })

        recommendation_explanations.append(
            _generate_explanation(
                ngo_name=ngo.name,
                ngo_category=ngo.category,
                ngo_motto=ngo.motto,
                confidence=confidence,
                percentage=percentage,
                issue_text=issue_text,
            )
        )

    return {
        "merged_problem_description": issue_text,
        "recommended_ngos": recommended_ngos,
        "recommendation_explanations": recommendation_explanations,
        "ai_image_caption": ai_caption,
        "ai_scene_category": ai_category,
    }
