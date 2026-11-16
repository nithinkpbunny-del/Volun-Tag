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
import re
import threading
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Optional

import numpy as np
from sklearn.metrics.pairwise import cosine_similarity
from sqlalchemy.orm import Session

try:
    from .db_models import IssueDB, NGODB
    from .embedding_store import get_vectors
    from .matching import classify_confidence, encode_texts
    from .matching_config import (
        CATEGORY_BOOST, ISSUE_CATEGORY_KEYWORDS, ISSUE_TOP_N,
        MATCHABLE_NGO_STATUSES, MIN_ISSUE_MATCH,
    )
    from .settings import AI_IMAGE_MAX_SIDE, UPLOAD_DIR
except ImportError:
    from db_models import IssueDB, NGODB
    from embedding_store import get_vectors
    from matching import classify_confidence, encode_texts
    from matching_config import (
        CATEGORY_BOOST, ISSUE_CATEGORY_KEYWORDS, ISSUE_TOP_N,
        MATCHABLE_NGO_STATUSES, MIN_ISSUE_MATCH,
    )
    from settings import AI_IMAGE_MAX_SIDE, UPLOAD_DIR


logger = logging.getLogger(__name__)


# ─── Model singletons (lazy-loaded) ────────────────────────────────

# BLIP and CLIP are loaded only when an issue actually has images.
_blip_processor = None
_blip_model = None
_blip_load_lock = threading.Lock()
_clip_processor = None
_clip_model = None
_clip_load_lock = threading.Lock()

# One BLIP/CLIP inference at a time. Separate from matching.MODEL_LOCK
# (MiniLM), so a slow photo report does not block volunteer matching.
IMAGE_MODEL_LOCK = threading.Lock()

# CLIP reads at most 77 tokens of text.
CLIP_MAX_TOKENS = 77


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


# ─── Keywords and thresholds come from matching_config.py ──────────

CATEGORY_KEYWORDS = ISSUE_CATEGORY_KEYWORDS
CATEGORY_LABELS = list(CATEGORY_KEYWORDS.keys())
TOP_N = ISSUE_TOP_N


# ─── Helpers ────────────────────────────────────────────────────────

_classify_confidence = classify_confidence  # same thresholds as volunteer matching


@lru_cache(maxsize=256)
def _issue_keyword_pattern(keyword: str):
    # Starts on a word boundary and allows a plural ending, so "pet" matches
    # "pets" but no longer "carpet", and "school" matches "schools".
    return re.compile(r"\b" + re.escape(keyword) + r"(?:s|es)?\b")


def _issue_keywords(issue_text: str, category: str) -> list[str]:
    if not category or category not in CATEGORY_KEYWORDS:
        return []
    text_lower = (issue_text or "").lower()
    return [kw for kw in CATEGORY_KEYWORDS[category] if _issue_keyword_pattern(kw).search(text_lower)]


def _compute_category_boost(issue_text: str, category: str) -> float:
    """Return a score boost when the issue text contains category keywords."""
    matches = len(_issue_keywords(issue_text, category))
    if matches == 0:
        return 0.0
    return min(matches / 3.0, 1.0) * CATEGORY_BOOST


# ─── Image understanding ───────────────────────────────────────────

@dataclass
class ImageAnalysis:
    """What BLIP and CLIP saw in a report's photos (computed once per report)."""

    caption: Optional[str] = None
    category: Optional[str] = None
    # CLIP cosine similarity of each readable photo with the description.
    similarities: list = field(default_factory=list)
    images_read: int = 0

    @property
    def best_similarity(self) -> Optional[float]:
        return max(self.similarities) if self.similarities else None


def load_ai_image(filepath):
    """Open a photo as RGB, shrunk to fit AI_IMAGE_MAX_SIDE (keeps memory and time bounded)."""
    from PIL import Image

    with Image.open(filepath) as img:
        img.draft("RGB", (AI_IMAGE_MAX_SIDE, AI_IMAGE_MAX_SIDE))  # cheap JPEG downscale
        rgb = img.convert("RGB")
    rgb.thumbnail((AI_IMAGE_MAX_SIDE, AI_IMAGE_MAX_SIDE))
    return rgb


def _caption_image(image) -> Optional[str]:
    """Generate a BLIP caption for a PIL Image.  Returns None on failure."""
    try:
        import torch
        processor, model = _get_blip()
        inputs = processor(images=image, return_tensors="pt")
        with IMAGE_MODEL_LOCK, torch.no_grad():
            output = model.generate(**inputs, max_new_tokens=50)
        caption = processor.decode(output[0], skip_special_tokens=True).strip()
        return caption if caption else None
    except Exception:
        logger.exception("BLIP captioning failed for an image")
        return None


def description_prompt(description: str) -> str:
    return f"a photo of {' '.join((description or '').split())}"


def _clip_image_scores(image, description: Optional[str]):
    """One CLIP pass: (best category label, similarity to description or None)."""
    try:
        import torch
        processor, model = _get_clip()
        texts = [f"a photo related to {cat}" for cat in CATEGORY_LABELS]
        with_description = bool(description and description.strip())
        if with_description:
            texts.append(description_prompt(description))

        inputs = processor(
            text=texts, images=image, return_tensors="pt",
            padding=True, truncation=True, max_length=CLIP_MAX_TOKENS,
        )
        with IMAGE_MODEL_LOCK, torch.no_grad():
            outputs = model(**inputs)

        n_labels = len(CATEGORY_LABELS)
        # Category: softmax over the label prompts only (unchanged behaviour).
        label_logits = outputs.logits_per_image[0][:n_labels]
        best_idx = int(torch.argmax(label_logits.softmax(dim=0)))
        category = CATEGORY_LABELS[best_idx]

        similarity = None
        if with_description:
            img = outputs.image_embeds[0]
            txt = outputs.text_embeds[-1]
            similarity = float(
                torch.nn.functional.cosine_similarity(img, txt, dim=0)
            )
        return category, similarity
    except Exception:
        logger.exception("CLIP failed for an image")
        return None, None


def _classify_image_category(image) -> Optional[str]:
    """Use CLIP zero-shot to pick the best VolunTag category for a PIL Image."""
    category, _ = _clip_image_scores(image, None)
    return category


def analyse_images(
    image_paths: list[str],
    description: Optional[str] = None,
    base_dir=None,
    caption: bool = True,
) -> ImageAnalysis:
    """Run BLIP (caption) and CLIP (category + description similarity) once per photo.

    Unreadable photos are skipped. The caller decides what a low similarity means.
    """
    from collections import Counter

    base_dir = base_dir or UPLOAD_DIR
    captions: list[str] = []
    categories: list[str] = []
    result = ImageAnalysis()

    for filename in image_paths or []:
        filepath = base_dir / filename
        if not filepath.is_file():
            logger.warning("Image file not found, skipping: %s", filepath.name)
            continue

        try:
            img = load_ai_image(filepath)
        except Exception:
            logger.exception("Could not open image, skipping: %s", filepath.name)
            continue

        result.images_read += 1

        if caption:
            text = _caption_image(img)
            if text:
                captions.append(text)

        category, similarity = _clip_image_scores(img, description)
        if category:
            categories.append(category)
        if similarity is not None:
            result.similarities.append(similarity)

    result.caption = "; ".join(captions) if captions else None
    if categories:
        result.category = Counter(categories).most_common(1)[0][0]

    return result


def _process_images(image_paths: list[str]) -> tuple[Optional[str], Optional[str]]:
    """Process uploaded images and return (combined_caption, best_category)."""
    analysis = analyse_images(image_paths)
    return analysis.caption, analysis.category


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
        category_keywords_matched = _issue_keywords(issue_lower, ngo_category)

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

def process_issue(
    issue: IssueDB,
    db: Session,
    image_analysis: Optional[ImageAnalysis] = None,
) -> dict:
    """Analyse a reported issue and recommend the relevant NGOs.

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
        ``recommended_ngos`` – the top 3 NGOs plus every NGO at or above
        45% (MIN_ISSUE_MATCH), ordered by score; each a recommendation dict
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

    if image_analysis is not None:
        # Already computed by the caller (the report's photo check); reuse it.
        ai_caption, ai_category = image_analysis.caption, image_analysis.category
    elif issue.image_paths and isinstance(issue.image_paths, list) and len(issue.image_paths) > 0:
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
    # Same NGOs as every other matching screen (rejected NGOs never get reports).
    ngos = (
        db.query(NGODB)
        .filter(NGODB.verification_status.in_(MATCHABLE_NGO_STATUSES))
        .order_by(NGODB.id)
        .all()
    )
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

    # 7. Rank; always keep the top-N, plus every NGO at or above the threshold
    order = np.argsort(boosted_scores)[::-1]
    top_indices = [
        i for rank, i in enumerate(order)
        if rank < TOP_N or boosted_scores[i] >= MIN_ISSUE_MATCH
    ]

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
