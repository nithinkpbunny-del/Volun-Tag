import os
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("OMP_NUM_THREADS", "2")
os.environ.setdefault("MKL_NUM_THREADS", "2")
os.environ.setdefault("HF_HUB_OFFLINE", "1")

import logging
import mimetypes
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sklearn.metrics.pairwise import cosine_similarity
from sqlalchemy import func
from sqlalchemy.orm import Session
import numpy as np

try:
    from .admin import router as admin_router
    from .admin_auth import is_admin_request, log_admin_action, require_admin
    from .database import Base, SessionLocal, engine, get_db
    from .db_models import ActivityDB, ActivitySignupDB, IssueResolutionDB, MessageDB, NGODB, IssueDB, VolunteerDB
    from .embedding_store import get_vectors, refresh_vector
    from .issue_service import (
        ISSUE_STATUSES,
        create_issue,
        delete_issue,
        get_issue_by_complaint_id,
        get_issue_stats,
        get_issues,
        update_issue_status,
    )
    from .issue_ai_pipeline import process_issue
    from .schemas import (
        Volunteer, NGO, IssueCreate, IssueStatusUpdate, IssueResponse,
        IssueStatsResponse, IssueDeleteResponse, VolunteerDashboardResponse,
        NGODashboardResponse, EventCreate, EventResponse, EventStatusUpdate,
        EventUpdate, NGOEventsResponse, NGOIssuesResponse, NGOIssueEntry,
        EventVolunteerEntry, EventVolunteersResponse, ApprovalResponse,
        VolunteerMatchEntry, VolunteerMatchesResponse,
        VolunteerEventEntry, VolunteerActivityEntry, JoinRequest, JoinResponse,
        MessageSend, LocationMessageSend, MessageResponse, ConversationEntry,
        MarkReadRequest, MarkReadResponse, FeedbackRequest, FeedbackResponse,
        ResolutionResponse, VolunteerIssueEntry, AdminResolutionEntry,
        RejectRequest,
    )
    from .migrations import ensure_signup_columns
    from .matching import CATEGORY_KEYWORDS, CATEGORY_BOOST, compute_category_boost, compute_location_boost, compute_match_level, classify_confidence
    from .seed_data import SEED_NGOS, SEED_VOLUNTEERS, run_seed
except ImportError:
    from admin import router as admin_router
    from admin_auth import is_admin_request, log_admin_action, require_admin
    from database import Base, SessionLocal, engine, get_db
    from db_models import ActivityDB, ActivitySignupDB, IssueResolutionDB, MessageDB, NGODB, IssueDB, VolunteerDB
    from embedding_store import get_vectors, refresh_vector
    from issue_service import (
        ISSUE_STATUSES,
        create_issue,
        delete_issue,
        get_issue_by_complaint_id,
        get_issue_stats,
        get_issues,
        update_issue_status,
    )
    from issue_ai_pipeline import process_issue
    from schemas import (
        Volunteer, NGO, IssueCreate, IssueStatusUpdate, IssueResponse,
        IssueStatsResponse, IssueDeleteResponse, VolunteerDashboardResponse,
        NGODashboardResponse, EventCreate, EventResponse, EventStatusUpdate,
        EventUpdate, NGOEventsResponse, NGOIssuesResponse, NGOIssueEntry,
        EventVolunteerEntry, EventVolunteersResponse, ApprovalResponse,
        VolunteerMatchEntry, VolunteerMatchesResponse,
        VolunteerEventEntry, VolunteerActivityEntry, JoinRequest, JoinResponse,
        MessageSend, LocationMessageSend, MessageResponse, ConversationEntry,
        MarkReadRequest, MarkReadResponse, FeedbackRequest, FeedbackResponse,
        ResolutionResponse, VolunteerIssueEntry, AdminResolutionEntry,
        RejectRequest,
    )
    from migrations import ensure_signup_columns
    from matching import CATEGORY_KEYWORDS, CATEGORY_BOOST, compute_category_boost, compute_location_boost, compute_match_level, classify_confidence
    from seed_data import SEED_NGOS, SEED_VOLUNTEERS, run_seed


logger = logging.getLogger(__name__)

UPLOAD_DIR = Path(__file__).resolve().parent / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MESSAGES_UPLOAD_DIR = UPLOAD_DIR / "messages"
MESSAGES_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
RESOLUTIONS_UPLOAD_DIR = UPLOAD_DIR / "resolutions"
RESOLUTIONS_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_IMAGE_TYPES = {
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/bmp",
    "image/tiff",
}

ALLOWED_DOCUMENT_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
}

ALLOWED_RESOLUTION_DOCUMENT_TYPES = {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": (
        "application/vnd.openxmlformats-officedocument."
        "wordprocessingml.document"
    ),
}

MAX_IMAGES = 6
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10 MB per file
MAX_DOCUMENT_SIZE = 5 * 1024 * 1024  # 5 MB per solution document

MIN_EVENT_MATCH = 0.45  # minimum final score for an event to be shown


app = FastAPI(
    title="VolunTag API",
    description="AI-powered volunteer-NGO matching platform",
    version="2.0.0",
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(admin_router)


# ─── Startup / Seed Data ───────────────────────────────────────────
@app.on_event("startup")
def seed_data():
    """Load sample data on server startup."""
    run_seed()
    ensure_signup_columns(engine)


# ─── Helpers ───────────────────────────────────────────────────────
async def save_ngo_file(
    upload: Optional[UploadFile],
    field_name: str,
) -> Optional[str]:
    """Save one optional NGO verification document."""

    if upload is None:
        return None

    if upload.content_type not in ALLOWED_DOCUMENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"{field_name} must be a PDF, JPG, JPEG, "
                f"or PNG file."
            ),
        )

    contents = await upload.read()

    if len(contents) > MAX_IMAGE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=(
                f"{field_name} exceeds the "
                f"{MAX_IMAGE_SIZE // (1024 * 1024)} MB size limit."
            ),
        )

    ext = Path(upload.filename or "").suffix.lower()

    if ext not in {
        ".pdf",
        ".jpg",
        ".jpeg",
        ".png",
    }:
        ext = ".pdf"

    safe_name = f"ngo_{uuid.uuid4().hex}{ext}"
    destination = UPLOAD_DIR / safe_name

    with open(destination, "wb") as file:
        file.write(contents)

    return safe_name


def safe_upload_path(base_dir: Path, stored_name) -> Optional[Path]:
    """Resolve a stored bare filename inside base_dir, or None if unsafe."""

    name = Path(str(stored_name or "")).name

    if not name or name in {".", ".."}:
        return None

    path = (base_dir / name).resolve()

    try:
        path.relative_to(base_dir.resolve())
    except ValueError:
        return None

    return path


def save_image_upload(
    file: UploadFile,
    dest_dir: Path,
    prefix: str,
) -> tuple[str, Path]:
    """Validate and save one image; return (stored filename, full path)."""

    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"File '{file.filename}' is not a supported "
                f"image type. Allowed: JPEG, PNG, GIF, "
                f"WebP, BMP, TIFF."
            ),
        )

    contents = file.file.read()

    if not contents:
        raise HTTPException(
            status_code=400,
            detail=f"File '{file.filename}' is empty.",
        )

    if len(contents) > MAX_IMAGE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=(
                f"File '{file.filename}' exceeds the "
                f"{MAX_IMAGE_SIZE // (1024 * 1024)} MB "
                f"size limit."
            ),
        )

    ext = Path(file.filename or "").suffix.lower() if file.filename else ""

    if ext not in {
        ".jpg",
        ".jpeg",
        ".png",
        ".gif",
        ".webp",
        ".bmp",
        ".tiff",
        ".tif",
    }:
        ext = ".jpg"

    stored_name = f"{prefix}{uuid.uuid4().hex}{ext}"
    dest = dest_dir / stored_name

    with open(dest, "wb") as out:
        out.write(contents)

    return stored_name, dest


def save_document_upload(
    file: UploadFile,
    dest_dir: Path,
) -> tuple[str, str, Path]:
    """Validate and save a solution document.

    Returns (stored filename, original filename, full path).
    """

    original_name = Path(file.filename or "").name
    ext = Path(original_name).suffix.lower()

    if (
        ext not in ALLOWED_RESOLUTION_DOCUMENT_TYPES
        or file.content_type != ALLOWED_RESOLUTION_DOCUMENT_TYPES[ext]
    ):
        raise HTTPException(
            status_code=400,
            detail="The document must be a PDF, DOC, or DOCX file.",
        )

    contents = file.file.read()

    if not contents:
        raise HTTPException(
            status_code=400,
            detail=f"File '{original_name}' is empty.",
        )

    if len(contents) > MAX_DOCUMENT_SIZE:
        raise HTTPException(
            status_code=400,
            detail=(
                f"File '{original_name}' exceeds the "
                f"{MAX_DOCUMENT_SIZE // (1024 * 1024)} MB "
                f"size limit."
            ),
        )

    stored_name = f"doc_{uuid.uuid4().hex}{ext}"
    dest = dest_dir / stored_name

    with open(dest, "wb") as out:
        out.write(contents)

    return stored_name, original_name[:255], dest


def issue_matches_ngo(issue: IssueDB, ngo: NGODB) -> bool:
    """True when the NGO appears in the issue's AI recommendations."""

    recs = issue.recommended_ngos

    if not recs or not isinstance(recs, list):
        return False

    return any(
        isinstance(entry, dict) and entry.get("ngo") == ngo.name
        for entry in recs
    )


def is_issue_reporter(issue: IssueDB, email: str) -> bool:
    return bool(
        issue.reporter_email
        and issue.reporter_email.strip().lower() == email.strip().lower()
    )


def get_owned_issue(db: Session, complaint_id: str, email: str) -> IssueDB:
    """Return the issue, or raise 404 / 403 if it is missing or not the reporter's."""

    issue = get_issue_by_complaint_id(db, complaint_id)

    if not issue:
        raise HTTPException(
            status_code=404,
            detail=f"Issue '{complaint_id}' not found",
        )

    if not is_issue_reporter(issue, email):
        raise HTTPException(
            status_code=403,
            detail="This problem was not reported by you",
        )

    return issue


def approved_resolutions(
    db: Session,
    complaint_ids: list[str],
) -> dict[str, tuple[IssueResolutionDB, str]]:
    """Map complaint_id -> (Approved resolution, solving NGO name) in one query."""

    if not complaint_ids:
        return {}

    rows = (
        db.query(IssueResolutionDB, NGODB.name)
        .join(NGODB, IssueResolutionDB.ngo_id == NGODB.id)
        .filter(
            IssueResolutionDB.complaint_id.in_(complaint_ids),
            IssueResolutionDB.status == "Approved",
        )
        .all()
    )

    return {res.complaint_id: (res, name) for res, name in rows}


def get_owned_event(db: Session, event_id: int, ngo_email: str) -> ActivityDB:
    """Return the event, or raise 404 / 403 if it is missing or not this NGO's."""

    event = db.query(ActivityDB).filter(
        ActivityDB.id == event_id,
    ).first()

    if not event:
        raise HTTPException(
            status_code=404,
            detail=f"Event '{event_id}' not found",
        )

    ngo = db.query(NGODB).filter(
        NGODB.id == event.ngo_id,
    ).first()

    # Email-only ownership check; real authentication is on the roadmap.
    if (
        not ngo
        or not ngo.email
        or ngo.email.strip().lower() != ngo_email.strip().lower()
    ):
        raise HTTPException(
            status_code=403,
            detail="This event does not belong to your NGO",
        )

    return event


def count_approved(db: Session, event_id: int) -> int:
    return db.query(func.count(ActivitySignupDB.id)).filter(
        ActivitySignupDB.activity_id == event_id,
        ActivitySignupDB.approved_at.isnot(None),
    ).scalar()


def is_past(event: ActivityDB) -> bool:
    return bool(event.event_date and event.event_date <= datetime.utcnow())


def is_completed(event: ActivityDB) -> bool:
    """True from the day after the event date, using the IST calendar date."""
    if not event.event_date:
        return False
    today_ist = (datetime.utcnow() + timedelta(hours=5, minutes=30)).date()
    return event.event_date.date() < today_ist


def is_full(event: ActivityDB, approved_count: int) -> bool:
    return (
        event.spots_available is not None
        and approved_count >= event.spots_available
    )


# ─── Root ──────────────────────────────────────────────────────────
@app.get("/")
def home():
    return {
        "message": "VolunTag backend running",
        "version": "2.0.0",
    }


# ─── Report Issue ─────────────────────────────────────────────────
@app.post(
    "/report-issue",
    response_model=IssueResponse,
    status_code=201,
)
def report_issue(
    user_description: str = Form(...),
    location: str = Form(...),
    reporter_email: str = Form(...),
    reporter_name: Optional[str] = Form(default=None),
    contact_information: Optional[str] = Form(default=None),
    images: list[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
):
    """Store a public issue report with optional image uploads and AI processing."""

    user_description = user_description.strip()
    location = location.strip()

    if not user_description:
        raise HTTPException(
            status_code=422,
            detail="user_description must not be empty",
        )

    if not location:
        raise HTTPException(
            status_code=422,
            detail="location must not be empty",
        )

    # ── Validate reporter via volunteer account ────────────────────
    reporter_email = reporter_email.strip().lower()

    if not reporter_email:
        raise HTTPException(
            status_code=403,
            detail="Register as a volunteer to report a problem",
        )

    volunteer = db.query(VolunteerDB).filter(
        func.lower(VolunteerDB.email) == reporter_email,
    ).first()

    if not volunteer:
        raise HTTPException(
            status_code=403,
            detail="Register as a volunteer to report a problem",
        )

    # Volunteer account is the single source of truth for identity.
    reporter_name = volunteer.name
    contact_information = volunteer.contact_number

    if len(images) > MAX_IMAGES:
        raise HTTPException(
            status_code=400,
            detail=f"Too many images. Maximum is {MAX_IMAGES}.",
        )

    for img in images:
        if img.content_type not in ALLOWED_IMAGE_TYPES:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"File '{img.filename}' is not a supported "
                    f"image type. Allowed: JPEG, PNG, GIF, "
                    f"WebP, BMP, TIFF."
                ),
            )

    saved_paths: list[str] = []
    saved_full_paths: list[Path] = []

    try:
        for img in images:
            contents = img.file.read()

            if len(contents) > MAX_IMAGE_SIZE:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"File '{img.filename}' exceeds the "
                        f"{MAX_IMAGE_SIZE // (1024 * 1024)} MB "
                        f"size limit."
                    ),
                )

            ext = (
                Path(img.filename or "").suffix.lower()
                if img.filename
                else ""
            )

            if ext not in {
                ".jpg",
                ".jpeg",
                ".png",
                ".gif",
                ".webp",
                ".bmp",
                ".tiff",
                ".tif",
            }:
                ext = ".jpg"

            safe_name = f"{uuid.uuid4().hex}{ext}"
            dest = UPLOAD_DIR / safe_name

            with open(dest, "wb") as file:
                file.write(contents)

            saved_paths.append(safe_name)
            saved_full_paths.append(dest)

    except HTTPException:
        for path in saved_full_paths:
            path.unlink(missing_ok=True)

        raise

    except Exception:
        for path in saved_full_paths:
            path.unlink(missing_ok=True)

        logger.exception("Failed to save uploaded images")

        raise HTTPException(
            status_code=500,
            detail="Failed to save uploaded images.",
        )

    issue_data = {
        "user_description": user_description,
        "location": location,
        "reporter_name": reporter_name,
        "contact_information": contact_information,
        "reporter_email": reporter_email,
        "image_paths": saved_paths if saved_paths else None,
    }

    issue = create_issue(db, issue_data)

    try:
        result = process_issue(issue, db)

        issue.ai_image_caption = result["ai_image_caption"]
        issue.ai_scene_category = result["ai_scene_category"]
        issue.merged_problem_description = (
            result["merged_problem_description"]
        )
        issue.recommended_ngos = result["recommended_ngos"]
        issue.recommendation_explanations = (
            result["recommendation_explanations"]
        )

        db.commit()
        db.refresh(issue)

    except Exception:
        logger.exception(
            "AI processing failed for issue %s; "
            "complaint saved without AI fields.",
            issue.complaint_id,
        )

        db.rollback()
        db.refresh(issue)

    return issue


# ─── Issue Routes ──────────────────────────────────────────────────
@app.get(
    "/issues",
    response_model=list[IssueResponse],
)
def list_issues(
    db: Session = Depends(get_db),
):
    """Return issue reports in newest-first order."""

    return get_issues(db)


@app.get(
    "/issues/{complaint_id}",
    response_model=IssueResponse,
)
def get_issue(
    complaint_id: str,
    db: Session = Depends(get_db),
):
    issue = get_issue_by_complaint_id(
        db,
        complaint_id,
    )

    if not issue:
        raise HTTPException(
            status_code=404,
            detail=f"Issue '{complaint_id}' not found",
        )

    return issue


@app.put(
    "/issues/{complaint_id}/status",
    response_model=IssueResponse,
    dependencies=[Depends(require_admin)],
)
def change_issue_status(
    complaint_id: str,
    status_update: IssueStatusUpdate,
    db: Session = Depends(get_db),
):
    issue = get_issue_by_complaint_id(
        db,
        complaint_id,
    )

    if not issue:
        raise HTTPException(
            status_code=404,
            detail=f"Issue '{complaint_id}' not found",
        )

    # Added before the update so update_issue_status commits both together.
    log_admin_action(db, "change_issue_status", "issue", complaint_id, {
        "old_status": issue.status,
        "new_status": status_update.status,
    })

    return update_issue_status(
        issue,
        status_update.status,
        db,
    )


@app.delete(
    "/issues/{complaint_id}",
    response_model=IssueDeleteResponse,
    dependencies=[Depends(require_admin)],
)
def remove_issue(
    complaint_id: str,
    db: Session = Depends(get_db),
):
    issue = get_issue_by_complaint_id(
        db,
        complaint_id,
    )

    if not issue:
        raise HTTPException(
            status_code=404,
            detail=f"Issue '{complaint_id}' not found",
        )

    # Added before the delete so delete_issue commits both together.
    log_admin_action(db, "delete_issue", "issue", complaint_id, {
        "complaint_id": complaint_id,
    })

    delete_issue(issue, db)

    return {
        "message": f"Issue '{complaint_id}' deleted",
        "complaint_id": complaint_id,
    }


@app.get(
    "/issue-stats",
    response_model=IssueStatsResponse,
)
def issue_stats(
    db: Session = Depends(get_db),
):
    return get_issue_stats(db)


# ─── NGO Submits Proof of Resolution ──────────────────────────────
@app.post(
    "/issues/{complaint_id}/resolution",
    response_model=ResolutionResponse,
    status_code=201,
)
def submit_issue_resolution(
    complaint_id: str,
    ngo_email: str = Form(...),
    solution_type: str = Form(...),
    solution_text: Optional[str] = Form(default=None),
    document: Optional[UploadFile] = File(default=None),
    before_photo: Optional[UploadFile] = File(default=None),
    after_photo: Optional[UploadFile] = File(default=None),
    db: Session = Depends(get_db),
):
    """Store an NGO's proof that it solved a reported problem."""

    issue = get_issue_by_complaint_id(db, complaint_id)

    if not issue:
        raise HTTPException(
            status_code=404,
            detail=f"Issue '{complaint_id}' not found",
        )

    ngo = db.query(NGODB).filter(
        NGODB.email.isnot(None),
        func.lower(NGODB.email) == ngo_email.strip().lower(),
    ).first()

    if not ngo:
        raise HTTPException(
            status_code=404,
            detail=f"No NGO found with email '{ngo_email}'",
        )

    if not issue_matches_ngo(issue, ngo):
        raise HTTPException(
            status_code=403,
            detail="This problem was not reported to your NGO",
        )

    if issue.status == "Resolved":
        raise HTTPException(
            status_code=400,
            detail="This problem has already been solved",
        )

    already_submitted = db.query(IssueResolutionDB.id).filter(
        IssueResolutionDB.complaint_id == issue.complaint_id,
        IssueResolutionDB.ngo_id == ngo.id,
    ).first()

    if already_submitted:
        raise HTTPException(
            status_code=400,
            detail="Your NGO has already submitted proof for this problem",
        )

    solution_type = solution_type.strip()

    if solution_type not in ("written", "document"):
        raise HTTPException(
            status_code=422,
            detail="solution_type must be 'written' or 'document'",
        )

    # Empty file parts (no file chosen) count as not provided.
    document = document if document is not None and document.filename else None
    before_photo = (
        before_photo if before_photo is not None and before_photo.filename else None
    )
    after_photo = (
        after_photo if after_photo is not None and after_photo.filename else None
    )

    solution_text = (solution_text or "").strip()

    if solution_type == "written":
        if not 50 <= len(solution_text) <= 5000:
            raise HTTPException(
                status_code=400,
                detail=(
                    "The written solution must be between 50 and "
                    "5000 characters."
                ),
            )

        if document is not None:
            raise HTTPException(
                status_code=400,
                detail="Provide either a written solution or a document, not both",
            )

    else:
        if document is None:
            raise HTTPException(
                status_code=400,
                detail="A document is required when the solution type is 'document'",
            )

        if solution_text:
            raise HTTPException(
                status_code=400,
                detail="Provide either a written solution or a document, not both",
            )

    if before_photo is None or after_photo is None:
        raise HTTPException(
            status_code=400,
            detail="Both a before photo and an after photo are required",
        )

    saved_full_paths: list[Path] = []

    try:
        before_name, before_path = save_image_upload(
            before_photo, RESOLUTIONS_UPLOAD_DIR, "before_",
        )
        saved_full_paths.append(before_path)

        after_name, after_path = save_image_upload(
            after_photo, RESOLUTIONS_UPLOAD_DIR, "after_",
        )
        saved_full_paths.append(after_path)

        document_path = None
        document_name = None

        if solution_type == "document":
            document_path, document_name, doc_full_path = save_document_upload(
                document, RESOLUTIONS_UPLOAD_DIR,
            )
            saved_full_paths.append(doc_full_path)

        resolution = IssueResolutionDB(
            complaint_id=issue.complaint_id,
            ngo_id=ngo.id,
            solution_type=solution_type,
            solution_text=solution_text if solution_type == "written" else None,
            document_path=document_path,
            document_name=document_name,
            before_photo=before_name,
            after_photo=after_name,
            status="Under evaluation",
        )
        db.add(resolution)
        issue.status = "Under evaluation"
        db.commit()
        db.refresh(resolution)

    except HTTPException:
        db.rollback()

        for path in saved_full_paths:
            path.unlink(missing_ok=True)

        raise

    except Exception:
        db.rollback()

        for path in saved_full_paths:
            path.unlink(missing_ok=True)

        logger.exception("Failed to save issue resolution")

        raise HTTPException(
            status_code=500,
            detail="Failed to save the resolution.",
        )

    return ResolutionResponse(
        resolution_id=resolution.id,
        complaint_id=resolution.complaint_id,
        status=resolution.status,
        submitted_at=resolution.submitted_at,
    )


# ─── Volunteer's Own Reported Problems ────────────────────────────
def build_volunteer_issue_entry(
    issue: IssueDB,
    solved_map: dict[str, tuple[IssueResolutionDB, str]],
) -> VolunteerIssueEntry:
    solved_res, solved_ngo_name = solved_map.get(
        issue.complaint_id, (None, None),
    )

    return VolunteerIssueEntry(
        complaint_id=issue.complaint_id,
        location=issue.location,
        user_description=issue.user_description,
        status=issue.status,
        created_at=issue.created_at,
        updated_at=issue.updated_at,
        image_count=len(issue.image_paths) if issue.image_paths else 0,
        ngo_count=len(issue.recommended_ngos) if issue.recommended_ngos else 0,
        editable=issue.status == "Reported",
        solved=issue.status == "Resolved",
        solved_by_ngo=solved_ngo_name,
        solved_at=solved_res.decided_at if solved_res else None,
    )


@app.get(
    "/volunteer-issues/{email}",
    response_model=list[VolunteerIssueEntry],
)
def list_volunteer_issues(
    email: str,
    db: Session = Depends(get_db),
):
    """Return the problems reported by one volunteer, newest first."""

    email_lower = email.strip().lower()

    volunteer = db.query(VolunteerDB).filter(
        func.lower(VolunteerDB.email) == email_lower,
    ).first()

    if not volunteer:
        raise HTTPException(
            status_code=404,
            detail=f"No volunteer found with email '{email}'",
        )

    issues = (
        db.query(IssueDB)
        .filter(func.lower(IssueDB.reporter_email) == email_lower)
        .order_by(IssueDB.created_at.desc(), IssueDB.id.desc())
        .all()
    )

    solved_map = approved_resolutions(
        db,
        [i.complaint_id for i in issues if i.status == "Resolved"],
    )

    return [build_volunteer_issue_entry(i, solved_map) for i in issues]


@app.patch(
    "/volunteer-issues/{complaint_id}",
    response_model=VolunteerIssueEntry,
)
def edit_volunteer_issue(
    complaint_id: str,
    email: str = Query(..., min_length=1),
    user_description: Optional[str] = Form(default=None),
    location: Optional[str] = Form(default=None),
    images: list[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
):
    """Edit a still-unhandled report: text can change, photos can only be added."""

    issue = get_owned_issue(db, complaint_id, email)

    if issue.status != "Reported":
        raise HTTPException(
            status_code=400,
            detail="This problem can no longer be edited",
        )

    # Empty file parts (no file chosen) count as not provided.
    new_images = [img for img in images if img.filename]

    if user_description is None and location is None and not new_images:
        raise HTTPException(
            status_code=400,
            detail="Nothing to update",
        )

    changed = False

    if user_description is not None:
        user_description = user_description.strip()

        if not user_description:
            raise HTTPException(
                status_code=422,
                detail="user_description must not be empty",
            )

        changed = changed or user_description != issue.user_description

    if location is not None:
        location = location.strip()

        if not location:
            raise HTTPException(
                status_code=422,
                detail="location must not be empty",
            )

        changed = changed or location != issue.location

    existing_paths = list(issue.image_paths or [])

    if len(existing_paths) + len(new_images) > MAX_IMAGES:
        raise HTTPException(
            status_code=400,
            detail=f"Too many images. Maximum is {MAX_IMAGES}.",
        )

    saved_names: list[str] = []
    saved_full_paths: list[Path] = []

    try:
        for img in new_images:
            stored_name, dest = save_image_upload(img, UPLOAD_DIR, "")
            saved_names.append(stored_name)
            saved_full_paths.append(dest)

    except HTTPException:
        for path in saved_full_paths:
            path.unlink(missing_ok=True)

        raise

    except Exception:
        for path in saved_full_paths:
            path.unlink(missing_ok=True)

        logger.exception("Failed to save uploaded images")

        raise HTTPException(
            status_code=500,
            detail="Failed to save uploaded images.",
        )

    if user_description is not None:
        issue.user_description = user_description

    if location is not None:
        issue.location = location

    if saved_names:
        # Assign a new list so the JSON column change is detected and saved.
        issue.image_paths = existing_paths + saved_names
        changed = True

    try:
        db.commit()
    except Exception:
        db.rollback()

        for path in saved_full_paths:
            path.unlink(missing_ok=True)

        logger.exception("Failed to update issue %s", issue.complaint_id)

        raise HTTPException(
            status_code=500,
            detail="Failed to update the problem.",
        )

    db.refresh(issue)

    if changed:
        try:
            result = process_issue(issue, db)

            issue.ai_image_caption = result["ai_image_caption"]
            issue.ai_scene_category = result["ai_scene_category"]
            issue.merged_problem_description = (
                result["merged_problem_description"]
            )
            issue.recommended_ngos = result["recommended_ngos"]
            issue.recommendation_explanations = (
                result["recommendation_explanations"]
            )

            db.commit()
            db.refresh(issue)

        except Exception:
            logger.exception(
                "AI re-processing failed for issue %s; "
                "edits kept with the previous matches.",
                issue.complaint_id,
            )

            db.rollback()
            db.refresh(issue)

    return build_volunteer_issue_entry(issue, {})


@app.delete(
    "/volunteer-issues/{complaint_id}",
    response_model=IssueDeleteResponse,
)
def delete_volunteer_issue(
    complaint_id: str,
    email: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
):
    """Delete a still-unhandled report together with its files."""

    issue = get_owned_issue(db, complaint_id, email)

    if issue.status != "Reported":
        raise HTTPException(
            status_code=400,
            detail=(
                "A problem that is under evaluation or already solved "
                "cannot be deleted"
            ),
        )

    files_to_remove: list[Path] = []

    image_names = (
        issue.image_paths if isinstance(issue.image_paths, list) else []
    )

    for name in image_names:
        path = safe_upload_path(UPLOAD_DIR, name)

        if path:
            files_to_remove.append(path)

    # Only Rejected resolutions can exist for a "Reported" issue.
    resolutions = db.query(IssueResolutionDB).filter(
        IssueResolutionDB.complaint_id == issue.complaint_id,
    ).all()

    for resolution in resolutions:
        for name in (
            resolution.before_photo,
            resolution.after_photo,
            resolution.document_path,
        ):
            path = safe_upload_path(RESOLUTIONS_UPLOAD_DIR, name)

            if path:
                files_to_remove.append(path)

        db.delete(resolution)

    db.delete(issue)
    db.commit()

    # Remove files only after the rows are gone.
    for path in files_to_remove:
        path.unlink(missing_ok=True)

    return {
        "message": f"Issue '{complaint_id}' deleted",
        "complaint_id": complaint_id,
    }


# ─── Admin: Review Resolutions ────────────────────────────────────
RESOLUTION_STATUSES = ("Under evaluation", "Approved", "Rejected", "Closed")


@app.get(
    "/admin/resolutions",
    response_model=list[AdminResolutionEntry],
    dependencies=[Depends(require_admin)],
)
def list_admin_resolutions(
    status: str = Query(default="Under evaluation"),
    db: Session = Depends(get_db),
):
    """List submitted proofs, newest first, filtered by resolution status (or "all")."""

    if status != "all" and status not in RESOLUTION_STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"status must be one of: all, {', '.join(RESOLUTION_STATUSES)}",
        )

    query = (
        db.query(IssueResolutionDB, NGODB.name)
        .join(NGODB, IssueResolutionDB.ngo_id == NGODB.id)
    )

    if status != "all":
        query = query.filter(IssueResolutionDB.status == status)

    rows = (
        query
        .order_by(
            IssueResolutionDB.submitted_at.desc(),
            IssueResolutionDB.id.desc(),
        )
        .all()
    )

    complaint_ids = list({res.complaint_id for res, _ in rows})
    issues_by_id = {}

    if complaint_ids:
        issues_by_id = {
            i.complaint_id: i
            for i in db.query(IssueDB).filter(
                IssueDB.complaint_id.in_(complaint_ids),
            ).all()
        }

    entries: list[AdminResolutionEntry] = []

    for res, ngo_name in rows:
        issue = issues_by_id.get(res.complaint_id)

        entries.append(AdminResolutionEntry(
            resolution_id=res.id,
            complaint_id=res.complaint_id,
            ngo_id=res.ngo_id,
            ngo_name=ngo_name,
            location=issue.location if issue else None,
            description=issue.user_description[:200] if issue else None,
            solution_type=res.solution_type,
            solution_text=res.solution_text,
            document_name=res.document_name,
            status=res.status,
            submitted_at=res.submitted_at,
            image_count=len(issue.image_paths) if issue and issue.image_paths else 0,
        ))

    return entries


@app.post(
    "/admin/resolutions/{resolution_id}/approve",
    dependencies=[Depends(require_admin)],
)
def approve_resolution(
    resolution_id: int,
    db: Session = Depends(get_db),
):
    """Accept an NGO's proof: the issue becomes Resolved and the reporter is told."""

    resolution = db.query(IssueResolutionDB).filter(
        IssueResolutionDB.id == resolution_id,
    ).first()

    if not resolution:
        raise HTTPException(
            status_code=404,
            detail=f"Resolution '{resolution_id}' not found",
        )

    if resolution.status != "Under evaluation":
        raise HTTPException(
            status_code=400,
            detail="This proof is not under evaluation",
        )

    issue = get_issue_by_complaint_id(db, resolution.complaint_id)

    if not issue:
        raise HTTPException(
            status_code=404,
            detail=f"Issue '{resolution.complaint_id}' not found",
        )

    if issue.status == "Resolved":
        raise HTTPException(
            status_code=400,
            detail="This problem has already been solved",
        )

    now = datetime.utcnow()

    resolution.status = "Approved"
    resolution.decided_at = now

    competing = db.query(IssueResolutionDB).filter(
        IssueResolutionDB.complaint_id == resolution.complaint_id,
        IssueResolutionDB.id != resolution.id,
        IssueResolutionDB.status == "Under evaluation",
    ).all()

    for other in competing:
        other.status = "Closed"
        other.reject_reason = "Another NGO's proof was approved"
        other.decided_at = now

    issue.status = "Resolved"

    ngo = db.query(NGODB).filter(NGODB.id == resolution.ngo_id).first()

    volunteer = None

    if issue.reporter_email:
        volunteer = db.query(VolunteerDB).filter(
            func.lower(VolunteerDB.email) == issue.reporter_email.strip().lower(),
        ).first()

    # Notify the reporter from the solving NGO (a message needs a sender email).
    # Emails are lowercased so the message lands in the existing thread.
    if volunteer and ngo and ngo.email:
        db.add(MessageDB(
            sender_email=ngo.email.strip().lower(),
            sender_role="ngo",
            recipient_email=volunteer.email.strip().lower(),
            recipient_role="volunteer",
            message_type="text",
            body=(
                f"Good news! {ngo.name} has marked the problem you "
                f"reported ({issue.complaint_id}) as solved. "
                f"Thank you for reporting it."
            ),
        ))

    log_admin_action(db, "approve_resolution", "resolution", resolution.id, {
        "complaint_id": resolution.complaint_id,
        "ngo_name": ngo.name if ngo else None,
        "closed_resolution_ids": [other.id for other in competing],
    })

    db.commit()

    return {
        "resolution_id": resolution.id,
        "complaint_id": resolution.complaint_id,
        "status": resolution.status,
    }


@app.post(
    "/admin/resolutions/{resolution_id}/reject",
    dependencies=[Depends(require_admin)],
)
def reject_resolution(
    resolution_id: int,
    payload: RejectRequest,
    db: Session = Depends(get_db),
):
    """Reject an NGO's proof with a reason."""

    resolution = db.query(IssueResolutionDB).filter(
        IssueResolutionDB.id == resolution_id,
    ).first()

    if not resolution:
        raise HTTPException(
            status_code=404,
            detail=f"Resolution '{resolution_id}' not found",
        )

    if resolution.status != "Under evaluation":
        raise HTTPException(
            status_code=400,
            detail="This proof is not under evaluation",
        )

    resolution.status = "Rejected"
    resolution.reject_reason = payload.reason
    resolution.decided_at = datetime.utcnow()

    issue = get_issue_by_complaint_id(db, resolution.complaint_id)

    still_pending = db.query(IssueResolutionDB.id).filter(
        IssueResolutionDB.complaint_id == resolution.complaint_id,
        IssueResolutionDB.id != resolution.id,
        IssueResolutionDB.status == "Under evaluation",
    ).first()

    if issue and not still_pending and issue.status == "Under evaluation":
        issue.status = "Reported"

    ngo_name = db.query(NGODB.name).filter(
        NGODB.id == resolution.ngo_id,
    ).scalar()

    log_admin_action(db, "reject_resolution", "resolution", resolution.id, {
        "complaint_id": resolution.complaint_id,
        "ngo_name": ngo_name,
        "reason": payload.reason,
    })

    db.commit()

    return {
        "resolution_id": resolution.id,
        "complaint_id": resolution.complaint_id,
        "status": resolution.status,
    }


# ─── Safe File Serving for Issue Photos and Proofs ────────────────
def serve_stored_file(
    base_dir: Path,
    stored_name,
    filename: Optional[str] = None,
) -> FileResponse:
    """Serve one stored file from base_dir, or 404 if it is unsafe or missing."""

    path = safe_upload_path(base_dir, stored_name)

    if path is None or not path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"

    if filename:
        return FileResponse(path=path, media_type=media_type, filename=filename)

    return FileResponse(path=path, media_type=media_type)


@app.get("/issue-files/issue/{complaint_id}/{index}")
def get_issue_photo(
    complaint_id: str,
    index: int,
    email: str = Query(default=""),
    is_admin: bool = Depends(is_admin_request),
    db: Session = Depends(get_db),
):
    """Serve one photo of a reported issue to its reporter, a matched NGO, or an admin."""

    issue = get_issue_by_complaint_id(db, complaint_id)

    if not issue:
        raise HTTPException(
            status_code=404,
            detail=f"Issue '{complaint_id}' not found",
        )

    allowed = is_admin or is_issue_reporter(issue, email)

    if not allowed and email.strip():
        ngo = db.query(NGODB).filter(
            NGODB.email.isnot(None),
            func.lower(NGODB.email) == email.strip().lower(),
        ).first()
        allowed = bool(ngo and issue_matches_ngo(issue, ngo))

    if not allowed:
        raise HTTPException(
            status_code=403,
            detail="You do not have access to this file",
        )

    names = issue.image_paths if isinstance(issue.image_paths, list) else []

    if index < 0 or index >= len(names):
        raise HTTPException(status_code=404, detail="File not found")

    return serve_stored_file(UPLOAD_DIR, names[index])


@app.get("/issue-files/resolution/{resolution_id}/{kind}")
def get_resolution_file(
    resolution_id: int,
    kind: str,
    email: str = Query(default=""),
    is_admin: bool = Depends(is_admin_request),
    db: Session = Depends(get_db),
):
    """Serve a proof file to the submitting NGO, the issue's reporter, or an admin."""

    resolution = db.query(IssueResolutionDB).filter(
        IssueResolutionDB.id == resolution_id,
    ).first()

    if not resolution:
        raise HTTPException(status_code=404, detail="File not found")

    if kind not in ("before", "after", "document"):
        raise HTTPException(status_code=404, detail="File not found")

    allowed = is_admin

    if not allowed and email.strip():
        email_lower = email.strip().lower()

        ngo = db.query(NGODB).filter(NGODB.id == resolution.ngo_id).first()
        allowed = bool(
            ngo and ngo.email and ngo.email.strip().lower() == email_lower
        )

        if not allowed:
            issue = get_issue_by_complaint_id(db, resolution.complaint_id)
            allowed = bool(issue and is_issue_reporter(issue, email_lower))

    if not allowed:
        raise HTTPException(
            status_code=403,
            detail="You do not have access to this file",
        )

    if kind == "document":
        return serve_stored_file(
            RESOLUTIONS_UPLOAD_DIR,
            resolution.document_path,
            filename=resolution.document_name,
        )

    stored_name = (
        resolution.before_photo if kind == "before" else resolution.after_photo
    )

    return serve_stored_file(RESOLUTIONS_UPLOAD_DIR, stored_name)


# ─── Volunteer Registration ────────────────────────────────────────
@app.post("/add-volunteer")
def add_volunteer(
    volunteer: Volunteer,
    db: Session = Depends(get_db),
):
    if db.query(VolunteerDB).filter(
        func.lower(VolunteerDB.name)
        == volunteer.name.lower()
    ).first():
        raise HTTPException(
            status_code=400,
            detail=f"Volunteer '{volunteer.name}' already exists",
        )

    if volunteer.email:
        existing_email = db.query(VolunteerDB).filter(
            func.lower(VolunteerDB.email)
            == volunteer.email.lower()
        ).first()

        if existing_email:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Email '{volunteer.email}' "
                    f"is already registered"
                ),
            )

    new_volunteer = VolunteerDB(
        name=volunteer.name,
        email=volunteer.email or None,
        contact_number=(
            volunteer.contact_number or None
        ),
        password=volunteer.password or None,
        age=volunteer.age,
        designation=volunteer.designation or None,
        gender=volunteer.gender or None,
        skills=volunteer.skills or None,
        location=volunteer.location or None,
        availability=volunteer.availability or None,
        experience=volunteer.experience or None,
    )

    db.add(new_volunteer)

    db.commit()

    # Pre-compute the skills vector so the first dashboard load is fast.
    if new_volunteer.skills:
        try:
            refresh_vector(
                db,
                "volunteer_skills",
                new_volunteer.id,
                new_volunteer.skills,
            )
        except Exception:
            logger.exception("Could not store volunteer skills embedding")

    total_volunteers = db.query(
        func.count(VolunteerDB.id)
    ).scalar()

    return {
        "message": "Volunteer added",
        "total_volunteers": total_volunteers,
    }


# ─── NGO Registration ──────────────────────────────────────────────
@app.post("/add-ngo")
async def add_ngo(
    name: str = Form(...),
    email: str = Form(...),
    contact_number: str = Form(...),
    password: str = Form(...),
    category: str = Form(...),
    location: str = Form(...),
    motto: str = Form(...),
    legal_structure: str = Form(...),
    year_founded: Optional[int] = Form(default=None),
    website_url: Optional[str] = Form(default=None),

    registration_cert: Optional[UploadFile] = File(
        default=None
    ),
    pan_card: Optional[UploadFile] = File(
        default=None
    ),
    cert_12a: Optional[UploadFile] = File(
        default=None
    ),
    cert_80g: Optional[UploadFile] = File(
        default=None
    ),
    cert_fcra: Optional[UploadFile] = File(
        default=None
    ),
    trust_deed: Optional[UploadFile] = File(
        default=None
    ),
    society_registration_certificate: Optional[UploadFile] = File(
        default=None
    ),
    society_moa: Optional[UploadFile] = File(
        default=None
    ),
    section8_incorporation_certificate: Optional[UploadFile] = File(
        default=None
    ),
    section8_moa_aoa: Optional[UploadFile] = File(
        default=None
    ),

    work_images: list[UploadFile] = File(default=[]),

    db: Session = Depends(get_db),
):
    """
    Register an NGO using multipart/form-data.

    Verification documents are currently optional.
    New NGOs are created with Pending verification status.
    """

    # ── Clean text fields ──────────────────────────────────────────
    name = name.strip()
    email = email.strip()
    contact_number = contact_number.strip()
    category = category.strip()
    location = location.strip()
    motto = motto.strip()
    legal_structure = legal_structure.strip()

    website_url = (
        website_url.strip()
        if website_url
        else None
    )

    # ── Validate required fields ───────────────────────────────────
    if not name:
        raise HTTPException(
            status_code=422,
            detail="Organization name is required",
        )

    if not email:
        raise HTTPException(
            status_code=422,
            detail="Email address is required",
        )

    if not contact_number:
        raise HTTPException(
            status_code=422,
            detail="Contact number is required",
        )

    if not password:
        raise HTTPException(
            status_code=422,
            detail="Password is required",
        )

    if not category:
        raise HTTPException(
            status_code=422,
            detail="Category is required",
        )

    if not location:
        raise HTTPException(
            status_code=422,
            detail="Location is required",
        )

    if not motto:
        raise HTTPException(
            status_code=422,
            detail="Motto is required",
        )

    if not legal_structure:
        raise HTTPException(
            status_code=422,
            detail="Legal structure is required",
        )

    # ── Duplicate NGO name ─────────────────────────────────────────
    existing_ngo = db.query(NGODB).filter(
        func.lower(NGODB.name)
        == name.lower()
    ).first()

    if existing_ngo:
        raise HTTPException(
            status_code=400,
            detail=f"NGO '{name}' already exists",
        )

    # ── Duplicate email ────────────────────────────────────────────
    existing_email = db.query(NGODB).filter(
        func.lower(NGODB.email)
        == email.lower()
    ).first()

    if existing_email:
        raise HTTPException(
            status_code=400,
            detail=f"Email '{email}' is already registered",
        )

    # ── Save optional verification documents ───────────────────────
    registration_certificate = await save_ngo_file(
        registration_cert,
        "Registration Certificate",
    )

    saved_pan_card = await save_ngo_file(
        pan_card,
        "PAN Card",
    )

    saved_12a = await save_ngo_file(
        cert_12a,
        "12A Certificate",
    )

    saved_80g = await save_ngo_file(
        cert_80g,
        "80G Certificate",
    )

    saved_fcra = await save_ngo_file(
        cert_fcra,
        "FCRA Certificate",
    )

    saved_trust_deed = await save_ngo_file(
        trust_deed,
        "Trust Deed",
    )

    saved_society_registration_certificate = await save_ngo_file(
        society_registration_certificate,
        "Society Registration Certificate",
    )

    saved_society_moa = await save_ngo_file(
        society_moa,
        "Society MOA",
    )

    saved_section8_incorporation_certificate = await save_ngo_file(
        section8_incorporation_certificate,
        "Section 8 Incorporation Certificate",
    )

    saved_section8_moa_aoa = await save_ngo_file(
        section8_moa_aoa,
        "Section 8 MOA/AOA",
    )

    # ── Save optional NGO work images ───────────────────────────────
    if len(work_images) > MAX_IMAGES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Maximum {MAX_IMAGES} work images are allowed."
            ),
        )

    saved_work_images: list[str] = []

    for image in work_images:
        if image.content_type not in ALLOWED_IMAGE_TYPES:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"'{image.filename}' is not a supported "
                    f"image type."
                ),
            )

        contents = await image.read()

        if len(contents) > MAX_IMAGE_SIZE:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"'{image.filename}' exceeds the "
                    f"{MAX_IMAGE_SIZE // (1024 * 1024)} MB "
                    f"size limit."
                ),
            )

        ext = Path(
            image.filename or ""
        ).suffix.lower()

        if ext not in {
            ".jpg",
            ".jpeg",
            ".png",
            ".gif",
            ".webp",
            ".bmp",
            ".tiff",
            ".tif",
        }:
            ext = ".jpg"

        safe_name = (
            f"ngo_work_{uuid.uuid4().hex}{ext}"
        )

        destination = UPLOAD_DIR / safe_name

        with open(destination, "wb") as file:
            file.write(contents)

        saved_work_images.append(safe_name)

    # ── Create NGO record ──────────────────────────────────────────
    ngo = NGODB(
        name=name,
        email=email,
        contact_number=contact_number,
        password=password,
        category=category,
        location=location,
        year_founded=year_founded,
        website_url=website_url,
        motto=motto,
        legal_structure=legal_structure,

        registration_certificate=(
            registration_certificate
        ),
        pan_card=saved_pan_card,
        cert_12a=saved_12a,
        cert_80g=saved_80g,
        cert_fcra=saved_fcra,
        trust_deed=saved_trust_deed,
        society_registration_certificate=(
            saved_society_registration_certificate
        ),
        society_moa=saved_society_moa,
        section8_incorporation_certificate=(
            saved_section8_incorporation_certificate
        ),
        section8_moa_aoa=saved_section8_moa_aoa,

        work_images=(
            saved_work_images
            if saved_work_images
            else None
        ),

        verification_status="Pending",
    )

    db.add(ngo)
    db.commit()
    db.refresh(ngo)

    total_ngos = db.query(
        func.count(NGODB.id)
    ).scalar()

    return {
        "message": (
            "NGO registration submitted "
            "for verification"
        ),
        "verification_status": (
            ngo.verification_status
        ),
        "ngo_id": ngo.id,
        "total_ngos": total_ngos,
    }


# ─── Organize Event ────────────────────────────────────────────────
@app.post(
    "/organize-event/{email}",
    response_model=EventResponse,
    status_code=201,
)
def organize_event(
    email: str,
    event: EventCreate,
    db: Session = Depends(get_db),
):
    ngo = db.query(NGODB).filter(
        NGODB.email.isnot(None),
        func.lower(NGODB.email)
        == email.strip().lower(),
    ).first()

    if not ngo:
        raise HTTPException(
            status_code=404,
            detail=f"No NGO found with email '{email}'",
        )

    activity = ActivityDB(
        ngo_id=ngo.id,
        title=event.title,
        description=event.description,
        required_skills=event.required_skills,
        location=event.location,
        event_date=event.event_date,
        spots_available=event.spots_available,
    )

    db.add(activity)
    db.commit()
    db.refresh(activity)

    if activity.required_skills and activity.required_skills.strip():
        try:
            refresh_vector(
                db,
                "event_skills",
                activity.id,
                activity.required_skills.strip(),
            )
        except Exception:
            logger.exception("Could not store event skills embedding")

    return activity


# ─── NGO Events ────────────────────────────────────────────────────
@app.get(
    "/ngo-events/{email}",
    response_model=NGOEventsResponse,
)
def get_ngo_events(
    email: str,
    include_cancelled: bool = Query(False),
    db: Session = Depends(get_db),
):
    ngo = db.query(NGODB).filter(
        NGODB.email.isnot(None),
        func.lower(NGODB.email)
        == email.strip().lower(),
    ).first()

    if not ngo:
        raise HTTPException(
            status_code=404,
            detail=f"No NGO found with email '{email}'",
        )

    query = db.query(ActivityDB).filter(
        ActivityDB.ngo_id == ngo.id,
    )

    if not include_cancelled:
        query = query.filter(
            ActivityDB.status == "Active",
        )

    events = (
        query.order_by(ActivityDB.created_at.desc())
        .all()
    )

    joined_counts: dict[int, int] = {}
    approved_counts: dict[int, int] = {}
    feedback_counts: dict[int, int] = {}
    if events:
        joined_counts = dict(
            db.query(
                ActivitySignupDB.activity_id,
                func.count(ActivitySignupDB.id),
            )
            .filter(
                ActivitySignupDB.activity_id.in_(
                    [ev.id for ev in events]
                ),
            )
            .group_by(ActivitySignupDB.activity_id)
            .all()
        )
        approved_counts = dict(
            db.query(
                ActivitySignupDB.activity_id,
                func.count(ActivitySignupDB.id),
            )
            .filter(
                ActivitySignupDB.activity_id.in_(
                    [ev.id for ev in events]
                ),
                ActivitySignupDB.approved_at.isnot(None),
            )
            .group_by(ActivitySignupDB.activity_id)
            .all()
        )
        feedback_counts = dict(
            db.query(
                ActivitySignupDB.activity_id,
                func.count(ActivitySignupDB.id),
            )
            .filter(
                ActivitySignupDB.activity_id.in_(
                    [ev.id for ev in events]
                ),
                ActivitySignupDB.approved_at.isnot(None),
                ActivitySignupDB.attendance_status.isnot(None),
            )
            .group_by(ActivitySignupDB.activity_id)
            .all()
        )

    event_responses = []
    for ev in events:
        item = EventResponse.model_validate(ev)
        item.joined_count = joined_counts.get(ev.id, 0)
        item.approved_count = approved_counts.get(ev.id, 0)
        item.feedback_count = feedback_counts.get(ev.id, 0)
        item.is_completed = is_completed(ev)
        event_responses.append(item)

    return NGOEventsResponse(
        ngo_name=ngo.name,
        total_events=len(events),
        events=event_responses,
    )


# ─── Event Volunteers (joined list for an NGO's event) ─────────────
@app.get(
    "/event-volunteers/{event_id}",
    response_model=EventVolunteersResponse,
)
def get_event_volunteers(
    event_id: int,
    ngo_email: str = Query(...),
    db: Session = Depends(get_db),
):
    event = get_owned_event(db, event_id, ngo_email)

    rows = (
        db.query(ActivitySignupDB, VolunteerDB)
        .join(
            VolunteerDB,
            ActivitySignupDB.volunteer_id == VolunteerDB.id,
        )
        .filter(ActivitySignupDB.activity_id == event.id)
        .order_by(
            ActivitySignupDB.approved_at.is_(None),
            ActivitySignupDB.created_at.asc(),
        )
        .all()
    )

    attended_counts: dict[int, int] = {}
    if rows:
        attended_counts = dict(
            db.query(
                ActivitySignupDB.volunteer_id,
                func.count(ActivitySignupDB.id),
            )
            .filter(
                ActivitySignupDB.volunteer_id.in_(
                    [vol.id for _, vol in rows]
                ),
                ActivitySignupDB.attendance_status == "attended",
            )
            .group_by(ActivitySignupDB.volunteer_id)
            .all()
        )

    volunteers = [
        EventVolunteerEntry(
            volunteer_id=vol.id,
            name=vol.name,
            email=vol.email,
            skills=vol.skills,
            experience=vol.experience,
            location=vol.location,
            events_attended=attended_counts.get(vol.id, 0),
            joined_at=signup.created_at,
            approved=signup.approved_at is not None,
            approved_at=signup.approved_at,
            attendance_status=signup.attendance_status,
            rating=(
                signup.rating
                if signup.attendance_status == "attended"
                else None
            ),
            feedback=(
                signup.feedback
                if signup.attendance_status == "attended"
                else None
            ),
        )
        for signup, vol in rows
    ]

    return EventVolunteersResponse(
        event_id=event.id,
        title=event.title,
        status=event.status,
        spots_available=event.spots_available,
        joined_count=len(volunteers),
        approved_count=sum(1 for v in volunteers if v.approved),
        volunteers=volunteers,
        is_completed=is_completed(event),
    )


# ─── Approve / Unapprove a joined volunteer ────────────────────────
@app.post(
    "/event-volunteers/{event_id}/{volunteer_id}/approve",
    response_model=ApprovalResponse,
)
def approve_event_volunteer(
    event_id: int,
    volunteer_id: int,
    ngo_email: str = Query(...),
    db: Session = Depends(get_db),
):
    event = get_owned_event(db, event_id, ngo_email)

    if event.status != "Active":
        raise HTTPException(
            status_code=400,
            detail="Only an active event can have volunteers approved",
        )

    if is_past(event):
        raise HTTPException(
            status_code=400,
            detail="This event has already passed",
        )

    signup = db.query(ActivitySignupDB).filter(
        ActivitySignupDB.activity_id == event.id,
        ActivitySignupDB.volunteer_id == volunteer_id,
    ).first()

    if not signup:
        raise HTTPException(
            status_code=404,
            detail="This volunteer has not joined this event",
        )

    approved_count = count_approved(db, event.id)

    # Idempotent: already approved.
    if signup.approved_at is not None:
        return ApprovalResponse(
            volunteer_id=volunteer_id,
            approved=True,
            approved_count=approved_count,
        )

    if is_full(event, approved_count):
        raise HTTPException(
            status_code=400,
            detail="All spots for this event are already filled",
        )

    signup.approved_at = datetime.utcnow()
    db.commit()

    return ApprovalResponse(
        volunteer_id=volunteer_id,
        approved=True,
        approved_count=approved_count + 1,
    )


@app.post(
    "/event-volunteers/{event_id}/{volunteer_id}/unapprove",
    response_model=ApprovalResponse,
)
def unapprove_event_volunteer(
    event_id: int,
    volunteer_id: int,
    ngo_email: str = Query(...),
    db: Session = Depends(get_db),
):
    event = get_owned_event(db, event_id, ngo_email)

    if is_past(event):
        raise HTTPException(
            status_code=400,
            detail="This event has already passed",
        )

    signup = db.query(ActivitySignupDB).filter(
        ActivitySignupDB.activity_id == event.id,
        ActivitySignupDB.volunteer_id == volunteer_id,
    ).first()

    if not signup:
        raise HTTPException(
            status_code=404,
            detail="This volunteer has not joined this event",
        )

    # Idempotent: if not approved there is nothing to change.
    if signup.approved_at is not None:
        signup.approved_at = None
        db.commit()

    return ApprovalResponse(
        volunteer_id=volunteer_id,
        approved=False,
        approved_count=count_approved(db, event.id),
    )


@app.post(
    "/event-volunteers/{event_id}/{volunteer_id}/feedback",
    response_model=FeedbackResponse,
)
def submit_event_volunteer_feedback(
    event_id: int,
    volunteer_id: int,
    body: FeedbackRequest,
    ngo_email: str = Query(...),
    db: Session = Depends(get_db),
):
    event = get_owned_event(db, event_id, ngo_email)

    if event.status == "Cancelled":
        raise HTTPException(
            status_code=400,
            detail="Cancelled events cannot be rated",
        )

    if not is_completed(event):
        raise HTTPException(
            status_code=400,
            detail="Feedback can be given only after the event date has passed",
        )

    signup = db.query(ActivitySignupDB).filter(
        ActivitySignupDB.activity_id == event.id,
        ActivitySignupDB.volunteer_id == volunteer_id,
    ).first()

    if not signup:
        raise HTTPException(
            status_code=404,
            detail="This volunteer has not joined this event",
        )

    if signup.approved_at is None:
        raise HTTPException(
            status_code=400,
            detail="Only approved volunteers can be rated",
        )

    if signup.attendance_status is not None:
        raise HTTPException(
            status_code=400,
            detail="Feedback has already been submitted for this volunteer",
        )

    if body.attendance == "attended":
        rating = body.rating
        if (
            not isinstance(rating, int)
            or isinstance(rating, bool)
            or not 1 <= rating <= 5
        ):
            raise HTTPException(
                status_code=400,
                detail="Rating must be between 1 and 5",
            )

        feedback = (body.feedback or "").strip()
        if not feedback:
            raise HTTPException(
                status_code=400,
                detail="Feedback text is required",
            )
        if len(feedback) > 1000:
            raise HTTPException(
                status_code=400,
                detail="Feedback must be 1000 characters or fewer",
            )

        signup.attendance_status = "attended"
        signup.attended_at = datetime.utcnow()
        signup.rating = rating
        signup.feedback = feedback
    else:
        signup.attendance_status = "not_attended"
        signup.attended_at = None
        signup.rating = None
        signup.feedback = None

    db.commit()

    feedback_count = db.query(func.count(ActivitySignupDB.id)).filter(
        ActivitySignupDB.activity_id == event.id,
        ActivitySignupDB.approved_at.isnot(None),
        ActivitySignupDB.attendance_status.isnot(None),
    ).scalar()

    return FeedbackResponse(
        volunteer_id=volunteer_id,
        attendance_status=signup.attendance_status,
        rating=signup.rating,
        feedback=signup.feedback,
        feedback_count=feedback_count,
    )


# ─── NGO Issues (reported problems matched to an NGO) ─────────────
@app.get(
    "/ngo-issues/{email}",
    response_model=NGOIssuesResponse,
)
def get_ngo_issues(
    email: str,
    db: Session = Depends(get_db),
):
    """Return issues whose AI recommendations include the NGO identified by *email*."""

    ngo = db.query(NGODB).filter(
        NGODB.email.isnot(None),
        func.lower(NGODB.email) == email.strip().lower(),
    ).first()

    if not ngo:
        raise HTTPException(
            status_code=404,
            detail=f"No NGO found with email '{email}'",
        )

    all_issues = (
        db.query(IssueDB)
        .order_by(IssueDB.created_at.desc(), IssueDB.id.desc())
        .all()
    )

    # This NGO's own proofs, and the Approved proof of every Resolved issue.
    own_resolutions = {
        res.complaint_id: res
        for res in db.query(IssueResolutionDB).filter(
            IssueResolutionDB.ngo_id == ngo.id,
        ).all()
    }
    approved_by_issue = {
        complaint_id: res
        for complaint_id, (res, _name) in approved_resolutions(
            db,
            [i.complaint_id for i in all_issues if i.status == "Resolved"],
        ).items()
    }

    matched: list[NGOIssueEntry] = []

    for issue in all_issues:
        recs = issue.recommended_ngos
        if not recs or not isinstance(recs, list):
            continue

        # A solved issue stays visible only to the NGO whose proof was approved.
        solved_res = None
        if issue.status == "Resolved":
            solved_res = approved_by_issue.get(issue.complaint_id)
            if solved_res is None or solved_res.ngo_id != ngo.id:
                continue

        own_res = own_resolutions.get(issue.complaint_id)
        shown_res = solved_res or own_res

        expls = issue.recommendation_explanations
        if not isinstance(expls, list):
            expls = []

        for idx, entry in enumerate(recs):
            if not isinstance(entry, dict):
                continue
            if entry.get("ngo") == ngo.name:
                matched.append(NGOIssueEntry(
                    complaint_id=issue.complaint_id,
                    location=issue.location,
                    user_description=issue.user_description,
                    status=issue.status,
                    created_at=issue.created_at,
                    match_percentage=entry.get("percentage", 0.0),
                    confidence=entry.get("confidence", "Unknown"),
                    explanation=expls[idx] if idx < len(expls) else None,
                    reporter_name=issue.reporter_name,
                    reporter_phone=issue.contact_information,
                    reporter_email=issue.reporter_email,
                    ai_image_caption=issue.ai_image_caption,
                    ai_scene_category=issue.ai_scene_category,
                    resolution_status=own_res.status if own_res else None,
                    reject_reason=own_res.reject_reason if own_res else None,
                    solved=solved_res is not None,
                    solved_by_me=solved_res is not None,
                    solved_at=solved_res.decided_at if solved_res else None,
                    solution_type=shown_res.solution_type if shown_res else None,
                    solution_text=shown_res.solution_text if shown_res else None,
                    document_name=shown_res.document_name if shown_res else None,
                    resolution_id=shown_res.id if shown_res else None,
                    image_count=len(issue.image_paths) if issue.image_paths else 0,
                ))
                break  # one match per issue is enough

    return NGOIssuesResponse(ngo_name=ngo.name, issues=matched)


# ─── Update Event Status ───────────────────────────────────────────
@app.patch(
    "/event-status/{event_id}",
    response_model=EventResponse,
)
def update_event_status(
    event_id: int,
    status_update: EventStatusUpdate,
    db: Session = Depends(get_db),
):
    event = db.query(ActivityDB).filter(
        ActivityDB.id == event_id,
    ).first()

    if not event:
        raise HTTPException(
            status_code=404,
            detail=f"Event '{event_id}' not found",
        )

    if is_completed(event):
        raise HTTPException(
            status_code=400,
            detail="This event has already been completed and can no longer be changed",
        )

    if status_update.status == "Filled":
        if event.status != "Active":
            raise HTTPException(
                status_code=400,
                detail="Only an active event can be marked as filled",
            )

        if event.spots_available is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Set the number of volunteers needed "
                    "before marking the event as filled"
                ),
            )

        approved = count_approved(db, event.id)

        if approved < event.spots_available:
            raise HTTPException(
                status_code=400,
                detail="Not enough volunteers have been approved yet",
            )

    event.status = status_update.status
    db.commit()
    db.refresh(event)

    return event


# ─── Update Event (partial) ────────────────────────────────────────
@app.patch("/update-event/{event_id}", response_model=EventResponse)
def update_event(
    event_id: int,
    event_update: EventUpdate,
    db: Session = Depends(get_db),
):
    event = db.query(ActivityDB).filter(
        ActivityDB.id == event_id,
    ).first()

    if not event:
        raise HTTPException(
            status_code=404,
            detail=f"Event '{event_id}' not found",
        )

    if is_completed(event):
        raise HTTPException(
            status_code=400,
            detail="This event has already been completed and can no longer be changed",
        )

    for field, value in event_update.model_dump(exclude_unset=True).items():
        setattr(event, field, value)

    db.commit()
    db.refresh(event)

    if event.required_skills and event.required_skills.strip():
        try:
            refresh_vector(
                db,
                "event_skills",
                event.id,
                event.required_skills.strip(),
            )
        except Exception:
            logger.exception("Could not store event skills embedding")

    return event


# ─── Data Retrieval ────────────────────────────────────────────────
@app.get("/volunteers")
def get_volunteers(
    db: Session = Depends(get_db),
):
    volunteers = (
        db.query(VolunteerDB)
        .order_by(VolunteerDB.id)
        .all()
    )

    return [
        {
            "name": v.name,
            "skills": v.skills,
            "location": v.location,
            "availability": v.availability,
            "experience": v.experience,
        }
        for v in volunteers
    ]



# ─── Volunteer Dashboard ───────────────────────────────────────────
@app.get(
    "/volunteer-dashboard/{email}",
    response_model=VolunteerDashboardResponse,
)
def get_volunteer_dashboard(
    email: str,
    db: Session = Depends(get_db),
):
    volunteer = db.query(VolunteerDB).filter(
        func.lower(VolunteerDB.email)
        == email.strip().lower()
    ).first()

    if not volunteer:
        raise HTTPException(
            status_code=404,
            detail=f"No volunteer found with email '{email}'",
        )

    return volunteer


@app.get("/ngos")
def get_ngos(
    db: Session = Depends(get_db),
):
    ngos = (
        db.query(NGODB)
        .order_by(NGODB.id)
        .all()
    )

    return [
        {
            "name": n.name,
            "email": n.email,
            "motto": n.motto,
            "category": n.category,
            "location": n.location,
            "verification_status": (
                n.verification_status
            ),
        }
        for n in ngos
    ]



# ─── NGO Dashboard ────────────────────────────────────────────────
@app.get(
    "/ngo-dashboard/{email}",
    response_model=NGODashboardResponse,
)
def get_ngo_dashboard(
    email: str,
    db: Session = Depends(get_db),
):
    ngo = db.query(NGODB).filter(
        NGODB.email.isnot(None),
        func.lower(NGODB.email)
        == email.strip().lower(),
    ).first()

    if not ngo:
        raise HTTPException(
            status_code=404,
            detail=f"No NGO found with email '{email}'",
        )

    return ngo


# ─── Delete Volunteer ──────────────────────────────────────────────
@app.delete("/delete-volunteer/{name}")
def delete_volunteer(
    name: str,
    db: Session = Depends(get_db),
):
    volunteer = db.query(VolunteerDB).filter(
        func.lower(VolunteerDB.name)
        == name.lower()
    ).first()

    if not volunteer:
        raise HTTPException(
            status_code=404,
            detail=f"Volunteer '{name}' not found",
        )

    db.delete(volunteer)
    db.commit()

    remaining = db.query(
        func.count(VolunteerDB.id)
    ).scalar()

    return {
        "message": f"Volunteer '{name}' deleted",
        "remaining": remaining,
    }


# ─── Delete NGO ────────────────────────────────────────────────────
@app.delete("/delete-ngo/{name}")
def delete_ngo(
    name: str,
    db: Session = Depends(get_db),
):
    ngo = db.query(NGODB).filter(
        func.lower(NGODB.name)
        == name.lower()
    ).first()

    if not ngo:
        raise HTTPException(
            status_code=404,
            detail=f"NGO '{name}' not found",
        )

    db.delete(ngo)
    db.commit()

    remaining = db.query(
        func.count(NGODB.id)
    ).scalar()

    return {
        "message": f"NGO '{name}' deleted",
        "remaining": remaining,
    }


# ─── Volunteer ↔ Activity Matching ─────────────────────────────────
@app.get(
    "/volunteer-matches/{email}",
    response_model=VolunteerMatchesResponse,
)
def get_volunteer_matches(
    email: str,
    db: Session = Depends(get_db),
):
    volunteer = db.query(VolunteerDB).filter(
        func.lower(VolunteerDB.email)
        == email.strip().lower()
    ).first()

    if not volunteer:
        raise HTTPException(
            status_code=404,
            detail=f"No volunteer found with email '{email}'",
        )

    if not volunteer.skills:
        return VolunteerMatchesResponse(
            volunteer_name=volunteer.name,
            matches=[],
        )

    # NGOs with Approved/Pending status
    ngos = (
        db.query(NGODB)
        .filter(
            NGODB.verification_status.in_(
                ["Approved", "Pending"]
            )
        )
        .order_by(NGODB.id)
        .all()
    )

    if not ngos:
        return VolunteerMatchesResponse(
            volunteer_name=volunteer.name,
            matches=[],
        )

    # For each NGO, check for its latest active event;
    # fall back to NGO motto if no active event exists.
    candidates = []

    for ngo in ngos:
        latest_event = (
            db.query(ActivityDB)
            .filter(
                ActivityDB.ngo_id == ngo.id,
                ActivityDB.status == "Active",
                (ActivityDB.event_date.is_(None))
                | (ActivityDB.event_date > datetime.utcnow()),
            )
            .order_by(
                ActivityDB.created_at.desc()
            )
            .first()
        )

        if latest_event and latest_event.required_skills and latest_event.required_skills.strip():
            candidates.append(
                {
                    "ngo": ngo,
                    "event": latest_event,
                    "match_text": latest_event.required_skills.strip(),
                }
            )
        elif ngo.motto and ngo.motto.strip():
            candidates.append(
                {
                    "ngo": ngo,
                    "event": None,
                    "match_text": ngo.motto.strip(),
                }
            )

    if not candidates:
        return VolunteerMatchesResponse(
            volunteer_name=volunteer.name,
            matches=[],
        )

    # Compute cosine similarity between volunteer skills
    # and each candidate's match text (event required_skills or NGO motto).
    vol_embedding = get_vectors(
        db,
        [("volunteer_skills", volunteer.id, volunteer.skills)],
    )

    candidate_embeddings = get_vectors(
        db,
        [
            (
                "event_skills" if c["event"] else "ngo_motto",
                c["event"].id if c["event"] else c["ngo"].id,
                c["match_text"],
            )
            for c in candidates
        ],
    )

    scores = cosine_similarity(
        vol_embedding,
        candidate_embeddings,
    )[0]

    matches = []

    for idx, c in enumerate(candidates):
        ngo = c["ngo"]
        event = c["event"]
        score = float(scores[idx])

        boost = compute_category_boost(
            volunteer.skills or "",
            ngo.category or "",
        )

        location_boost = compute_location_boost(
            volunteer.location or "",
            ngo.location or "",
        )

        final_score = max(0.0, min(score + boost + location_boost, 1.0))

        matches.append(
            VolunteerMatchEntry(
                ngo_name=ngo.name,
                ngo_category=ngo.category,
                ngo_location=ngo.location,
                event_title=event.title if event else None,
                match_percentage=round(
                    final_score * 100, 1
                ),
                level=compute_match_level(final_score, boost),
            )
        )

    matches.sort(
        key=lambda m: m.match_percentage or 0,
        reverse=True,
    )

    return VolunteerMatchesResponse(
        volunteer_name=volunteer.name,
        matches=matches,
    )


# ─── Volunteer ↔ Event Matching ────────────────────────────────────
@app.get(
    "/volunteer-events/{email}",
    response_model=list[VolunteerEventEntry],
)
def get_volunteer_events(
    email: str,
    db: Session = Depends(get_db),
):
    """Return scored & filtered events for a volunteer, sorted by match."""

    volunteer = db.query(VolunteerDB).filter(
        func.lower(VolunteerDB.email)
        == email.strip().lower()
    ).first()

    if not volunteer:
        raise HTTPException(
            status_code=404,
            detail=f"No volunteer found with email '{email}'",
        )

    if not volunteer.skills:
        return []

    # Active events whose date hasn't passed, from Approved/Pending NGOs.
    now = datetime.utcnow()

    events = (
        db.query(ActivityDB, NGODB)
        .join(NGODB, ActivityDB.ngo_id == NGODB.id)
        .filter(
            ActivityDB.status == "Active",
            NGODB.verification_status.in_(["Approved", "Pending"]),
        )
        .filter(
            (ActivityDB.event_date.is_(None))
            | (ActivityDB.event_date > now)
        )
        .all()
    )

    if not events:
        return []

    # Stored vectors for the volunteer and every event's required_skills text.
    vol_embedding = get_vectors(
        db,
        [("volunteer_skills", volunteer.id, volunteer.skills)],
    )
    event_embeddings = get_vectors(
        db,
        [
            ("event_skills", ev.id, ev.required_skills.strip())
            for ev, _ in events
        ],
    )

    scores = cosine_similarity(
        vol_embedding,
        event_embeddings,
    )[0]

    # This volunteer's signups as {activity_id: approved_at}, fetched once.
    my_signups = dict(
        db.query(
            ActivitySignupDB.activity_id,
            ActivitySignupDB.approved_at,
        ).filter(
            ActivitySignupDB.volunteer_id == volunteer.id,
        ).all()
    )

    approved_counts = dict(
        db.query(
            ActivitySignupDB.activity_id,
            func.count(ActivitySignupDB.id),
        )
        .filter(
            ActivitySignupDB.activity_id.in_([ev.id for ev, _ in events]),
            ActivitySignupDB.approved_at.isnot(None),
        )
        .group_by(ActivitySignupDB.activity_id)
        .all()
    )

    results: list[VolunteerEventEntry] = []

    for idx, (ev, ngo) in enumerate(events):
        score = float(scores[idx])

        boost = compute_category_boost(
            volunteer.skills or "",
            ngo.category or "",
        )

        location_boost = compute_location_boost(
            volunteer.location or "",
            ngo.location or "",
        )

        final_score = max(0.0, min(score + boost + location_boost, 1.0))

        # An event is shown only when the score is high enough AND the volunteer's skills hit a keyword of the NGO's category.
        if final_score < MIN_EVENT_MATCH or boost <= 0:
            continue

        # Hide full events from volunteers who have not joined them.
        if ev.id not in my_signups and is_full(
            ev, approved_counts.get(ev.id, 0)
        ):
            continue

        results.append(
            VolunteerEventEntry(
                activity_id=ev.id,
                title=ev.title,
                description=ev.description,
                location=ev.location,
                event_date=ev.event_date,
                required_skills=ev.required_skills,
                ngo_name=ngo.name,
                ngo_category=ngo.category,
                ngo_location=ngo.location,
                ngo_email=ngo.email,
                match_percentage=round(final_score * 100, 1),
                joined=ev.id in my_signups,
                approved=my_signups.get(ev.id) is not None,
            )
        )

    results.sort(
        key=lambda m: m.match_percentage,
        reverse=True,
    )

    return results


# ─── Volunteer Activity (every event the volunteer has joined) ─────
@app.get(
    "/volunteer-activity/{email}",
    response_model=list[VolunteerActivityEntry],
)
def get_volunteer_activity(
    email: str,
    db: Session = Depends(get_db),
):
    volunteer = db.query(VolunteerDB).filter(
        func.lower(VolunteerDB.email)
        == email.strip().lower()
    ).first()

    if not volunteer:
        raise HTTPException(
            status_code=404,
            detail=f"No volunteer found with email '{email}'",
        )

    rows = (
        db.query(ActivitySignupDB, ActivityDB, NGODB)
        .join(ActivityDB, ActivitySignupDB.activity_id == ActivityDB.id)
        .join(NGODB, ActivityDB.ngo_id == NGODB.id)
        .filter(ActivitySignupDB.volunteer_id == volunteer.id)
        .all()
    )

    entries: list[VolunteerActivityEntry] = []

    for signup, ev, ngo in rows:
        approved = signup.approved_at is not None
        attended = signup.attendance_status == "attended"

        if ev.status == "Cancelled":
            label = "Cancelled"
        elif attended:
            label = "Attended"
        elif signup.attendance_status == "not_attended":
            label = "Not attended"
        elif approved and is_completed(ev):
            label = "Awaiting NGO feedback"
        elif approved:
            label = "Approved"
        elif is_completed(ev):
            label = "Not selected"
        else:
            label = "Waiting for approval"

        entries.append(
            VolunteerActivityEntry(
                activity_id=ev.id,
                title=ev.title,
                ngo_name=ngo.name,
                ngo_email=ngo.email,
                location=ev.location,
                event_date=ev.event_date,
                event_status=ev.status,
                joined_at=signup.created_at,
                approved=approved,
                approved_at=signup.approved_at,
                attended=attended,
                status_label=label,
                attendance_status=signup.attendance_status,
                rating=signup.rating if attended else None,
                feedback=signup.feedback if attended else None,
            )
        )

    # Dated events newest first, undated events last.
    dated = sorted(
        (e for e in entries if e.event_date is not None),
        key=lambda e: e.event_date,
        reverse=True,
    )
    undated = [e for e in entries if e.event_date is None]

    return dated + undated


# ─── Join Activity ─────────────────────────────────────────────────
@app.post(
    "/activities/{activity_id}/join",
    response_model=JoinResponse,
)
def join_activity(
    activity_id: int,
    body: JoinRequest,
    db: Session = Depends(get_db),
):
    """Let a volunteer sign up for an activity."""

    volunteer = db.query(VolunteerDB).filter(
        func.lower(VolunteerDB.email)
        == body.volunteer_email.strip().lower()
    ).first()

    if not volunteer:
        raise HTTPException(
            status_code=404,
            detail=f"No volunteer found with email '{body.volunteer_email}'",
        )

    activity = db.query(ActivityDB).filter(
        ActivityDB.id == activity_id,
    ).first()

    if not activity:
        raise HTTPException(
            status_code=404,
            detail=f"Activity {activity_id} not found",
        )

    if activity.status == "Filled":
        raise HTTPException(
            status_code=400,
            detail="This activity is already full",
        )

    if activity.status != "Active":
        raise HTTPException(
            status_code=400,
            detail="This activity is no longer active",
        )

    if activity.event_date and activity.event_date <= datetime.utcnow():
        raise HTTPException(
            status_code=400,
            detail="This event has already passed",
        )

    # Idempotent: if already joined, return success without duplicating.
    existing = db.query(ActivitySignupDB).filter(
        ActivitySignupDB.activity_id == activity_id,
        ActivitySignupDB.volunteer_id == volunteer.id,
    ).first()

    if existing:
        return JoinResponse(joined=True, activity_id=activity_id)

    if is_full(activity, count_approved(db, activity_id)):
        raise HTTPException(
            status_code=400,
            detail="This activity is already full",
        )

    db.add(
        ActivitySignupDB(
            activity_id=activity_id,
            volunteer_id=volunteer.id,
        )
    )
    db.commit()

    return JoinResponse(joined=True, activity_id=activity_id)


# ─── Leave Activity ────────────────────────────────────────────────
@app.delete(
    "/activities/{activity_id}/join",
    response_model=JoinResponse,
)
def leave_activity(
    activity_id: int,
    volunteer_email: str = Query(...),
    db: Session = Depends(get_db),
):
    """Let a volunteer withdraw their signup from an activity."""

    # The email is trusted from the request; real authentication is on the roadmap.
    volunteer = db.query(VolunteerDB).filter(
        func.lower(VolunteerDB.email)
        == volunteer_email.strip().lower()
    ).first()

    if not volunteer:
        raise HTTPException(
            status_code=404,
            detail=f"No volunteer found with email '{volunteer_email}'",
        )

    activity = db.query(ActivityDB).filter(
        ActivityDB.id == activity_id,
    ).first()

    if not activity:
        raise HTTPException(
            status_code=404,
            detail=f"Activity {activity_id} not found",
        )

    if activity.event_date and activity.event_date <= datetime.utcnow():
        raise HTTPException(
            status_code=400,
            detail="This event has already passed",
        )

    signup = db.query(ActivitySignupDB).filter(
        ActivitySignupDB.activity_id == activity_id,
        ActivitySignupDB.volunteer_id == volunteer.id,
    ).first()

    if not signup:
        raise HTTPException(
            status_code=404,
            detail="You have not joined this activity",
        )

    if signup.approved_at is not None:
        raise HTTPException(
            status_code=400,
            detail=(
                "You have been approved for this event. "
                "Please contact the NGO to withdraw."
            ),
        )

    # The activity's status is intentionally left untouched: a Filled
    # event stays Filled and the NGO reopens it manually.
    db.delete(signup)
    db.commit()

    return JoinResponse(joined=False, activity_id=activity_id)


# ─── Volunteer ↔ NGO Matching ─────────────────────────────────────
@app.get("/match")
def match_volunteers(
    category: Optional[str] = Query(
        None,
        description="Filter by NGO category",
    ),
    min_score: Optional[float] = Query(
        None,
        ge=0,
        le=1,
        description="Minimum match score",
    ),
    top_n: Optional[int] = Query(
        3,
        ge=1,
        le=10,
        description="Number of top matches per volunteer",
    ),
    sort_by: Optional[str] = Query(
        "score",
        description="Sort by: score, name",
    ),
    db: Session = Depends(get_db),
):
    volunteers = (
        db.query(VolunteerDB)
        .filter(VolunteerDB.skills.isnot(None))
        .filter(VolunteerDB.skills != "")
        .order_by(VolunteerDB.id)
        .all()
    )

    # Only approved NGOs participate in matching.
    ngos = (
        db.query(NGODB)
        .filter(
            NGODB.verification_status.in_(
                ["Approved", "Pending"]
            )
        )
        .order_by(NGODB.id)
        .all()
    )

    if not volunteers or not ngos:
        return {
            "message": "Add volunteers and NGOs first",
            "matches": [],
        }

    # Filter NGOs by category.
    filtered_ngos = ngos

    if category:
        filtered_ngos = [
            n
            for n in ngos
            if n.category
            and n.category.lower()
            == category.lower()
        ]

        if not filtered_ngos:
            return {
                "message": (
                    f"No NGOs found in category "
                    f"'{category}'"
                ),
                "matches": [],
            }

    vol_embeddings = get_vectors(
        db,
        [
            ("volunteer_skills", v.id, v.skills)
            for v in volunteers
        ],
    )

    ngo_embeddings = get_vectors(
        db,
        [
            ("ngo_motto_raw", n.id, n.motto or "")
            for n in filtered_ngos
        ],
    )

    similarity_matrix = cosine_similarity(
        vol_embeddings,
        ngo_embeddings,
    )

    # Apply category boost.
    for i, volunteer in enumerate(volunteers):
        for j, ngo in enumerate(filtered_ngos):
            boost = compute_category_boost(
                volunteer.skills or "",
                ngo.category or "",
            )

            similarity_matrix[i][j] = min(
                similarity_matrix[i][j] + boost,
                1.0,
            )

    results = []

    for i, volunteer in enumerate(volunteers):
        scores = similarity_matrix[i]

        top_indices = np.argsort(scores)[::-1][:top_n]

        volunteer_matches = []

        for idx in top_indices:
            score = float(scores[idx])

            if (
                min_score is not None
                and score < min_score
            ):
                continue

            matched_ngo = filtered_ngos[idx]

            volunteer_matches.append(
                {
                    "ngo": matched_ngo.name,
                    "ngo_category": (
                        matched_ngo.category
                        or "Uncategorized"
                    ),
                    "ngo_motto": (
                        matched_ngo.motto
                    ),
                    "score": round(score, 4),
                    "percentage": round(
                        score * 100,
                        1,
                    ),
                    "confidence": classify_confidence(
                        score
                    ),
                }
            )

        if volunteer_matches:
            results.append(
                {
                    "volunteer": volunteer.name,
                    "volunteer_skills": (
                        volunteer.skills
                    ),
                    "volunteer_location": (
                        volunteer.location or ""
                    ),
                    "matches": volunteer_matches,
                    "best_score": (
                        volunteer_matches[0]["score"]
                    ),
                    "best_match": (
                        volunteer_matches[0]["ngo"]
                    ),
                }
            )

    if sort_by == "score":
        results.sort(
            key=lambda x: x["best_score"],
            reverse=True,
        )

    elif sort_by == "name":
        results.sort(
            key=lambda x: x["volunteer"]
        )

    return {
        "matches": results,
        "total_volunteers": len(volunteers),
        "total_ngos": len(filtered_ngos),
        "total_matches": len(results),
    }


# ─── Platform Stats ────────────────────────────────────────────────
@app.get("/stats")
def get_stats(
    db: Session = Depends(get_db),
):
    """Return platform statistics."""

    volunteers = (
        db.query(VolunteerDB)
        .order_by(VolunteerDB.id)
        .all()
    )

    ngos = (
        db.query(NGODB)
        .order_by(NGODB.id)
        .all()
    )

    category_counts = {}

    for ngo in ngos:
        category = (
            ngo.category
            or "Uncategorized"
        )

        category_counts[category] = (
            category_counts.get(category, 0) + 1
        )

    return {
        "total_volunteers": len(volunteers),
        "total_ngos": len(ngos),
        "categories": category_counts,
        "category_list": list(
            CATEGORY_KEYWORDS.keys()
        ),
    }


# ═══════════════════════════════════════════════════════════════════
#  MESSAGING
# ═══════════════════════════════════════════════════════════════════

def _resolve_role(email: str, db: Session) -> tuple[str, str]:
    """Return (role, display_name) for an email, or raise 404."""
    email_lower = email.strip().lower()

    vol = db.query(VolunteerDB).filter(
        func.lower(VolunteerDB.email) == email_lower,
    ).first()
    if vol:
        return "volunteer", vol.name

    ngo = db.query(NGODB).filter(
        NGODB.email.isnot(None),
        func.lower(NGODB.email) == email_lower,
    ).first()
    if ngo:
        return "ngo", ngo.name

    raise HTTPException(
        status_code=404,
        detail=f"No volunteer or NGO account found for '{email}'",
    )


def _fmt_dt(dt) -> str | None:
    """Format a datetime as ISO-8601 with trailing Z, or None."""
    if dt is None:
        return None
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _ngo_may_message_volunteer(
    ngo_email: str,
    volunteer_email: str,
    db: Session,
) -> bool:
    """Return True if the NGO is allowed to message the volunteer.

    An NGO may message a volunteer if:
    1. The volunteer has already sent a message to this NGO, OR
    2. An issue exists whose reporter_email matches the volunteer AND
       whose recommended_ngos contains an entry with "ngo" equal to
       this NGO's name.
    """
    ngo_lower = ngo_email.strip().lower()
    vol_lower = volunteer_email.strip().lower()

    # Check 1: prior message from volunteer → NGO
    prior = db.query(MessageDB.id).filter(
        MessageDB.sender_email == vol_lower,
        MessageDB.recipient_email == ngo_lower,
    ).first()
    if prior:
        return True

    # Check 2: matched issue
    ngo = db.query(NGODB).filter(
        NGODB.email.isnot(None),
        func.lower(NGODB.email) == ngo_lower,
    ).first()
    if not ngo:
        return False

    issues = (
        db.query(IssueDB)
        .filter(
            func.lower(IssueDB.reporter_email) == vol_lower,
        )
        .all()
    )
    for issue in issues:
        recs = issue.recommended_ngos
        if not recs or not isinstance(recs, list):
            continue
        for entry in recs:
            if isinstance(entry, dict) and entry.get("ngo") == ngo.name:
                return True

    # Check 3: volunteer signed up for any of this NGO's activities
    signed_up = (
        db.query(ActivitySignupDB.id)
        .join(
            ActivityDB,
            ActivitySignupDB.activity_id == ActivityDB.id,
        )
        .join(
            VolunteerDB,
            ActivitySignupDB.volunteer_id == VolunteerDB.id,
        )
        .filter(
            ActivityDB.ngo_id == ngo.id,
            func.lower(VolunteerDB.email) == vol_lower,
        )
        .first()
    )
    if signed_up:
        return True

    return False


def _validate_pair(
    sender_email: str,
    recipient_email: str,
    db: Session,
) -> tuple[str, str]:
    """Validate messaging rules between sender and recipient.

    Returns (sender_role, recipient_role).
    Applies the same rules as POST /messages:
    - 400 if sender == recipient (self)
    - 404 if either email is unknown (server-side role lookup)
    - 400 if both parties have the same role
    - 403 if an NGO tries to message a volunteer without prior message
      or matched issue
    """
    s_email = sender_email.strip().lower()
    r_email = recipient_email.strip().lower()

    if s_email == r_email:
        raise HTTPException(status_code=400, detail="Cannot message yourself")

    sender_role, _ = _resolve_role(s_email, db)
    recipient_role, _ = _resolve_role(r_email, db)

    # Same-role check
    if sender_role == recipient_role:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Both parties are {sender_role}s. "
                "Only volunteer ↔ NGO conversations are allowed."
            ),
        )

    # NGO can only message volunteers who messaged them or reported a matched issue
    if sender_role == "ngo":
        if not _ngo_may_message_volunteer(s_email, r_email, db):
            raise HTTPException(
                status_code=403,
                detail=(
                    "NGOs can only message volunteers who have "
                    "messaged them, joined one of their events, or reported a problem matched to them."
                ),
            )

    return sender_role, recipient_role


# ─── POST /messages ───────────────────────────────────────────────
@app.post("/messages", response_model=MessageResponse, status_code=201)
def send_message(
    payload: MessageSend,
    db: Session = Depends(get_db),
):
    """Send a text message between a volunteer and an NGO."""

    if payload.sender_email == payload.recipient_email:
        raise HTTPException(status_code=400, detail="Cannot message yourself")

    sender_role, sender_name = _resolve_role(payload.sender_email, db)
    recipient_role, recipient_name = _resolve_role(payload.recipient_email, db)

    # Same-role check
    if sender_role == recipient_role:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Both parties are {sender_role}s. "
                "Only volunteer ↔ NGO conversations are allowed."
            ),
        )

    # NGO can only message volunteers who messaged them or reported a matched issue
    if sender_role == "ngo":
        if not _ngo_may_message_volunteer(
            payload.sender_email, payload.recipient_email, db,
        ):
            raise HTTPException(
                status_code=403,
                detail=(
                    "NGOs can only message volunteers who have "
                    "messaged them, joined one of their events, or reported a problem matched to them."
                ),
            )

    msg = MessageDB(
        sender_email=payload.sender_email,
        sender_role=sender_role,
        recipient_email=payload.recipient_email,
        recipient_role=recipient_role,
        message_type="text",
        body=payload.body,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)

    return MessageResponse(
        id=msg.id,
        sender_email=msg.sender_email,
        sender_role=msg.sender_role,
        recipient_email=msg.recipient_email,
        recipient_role=msg.recipient_role,
        message_type=msg.message_type,
        body=msg.body,
        file_path=None,
        file_name=msg.file_name,
        file_size=msg.file_size,
        mime_type=msg.mime_type,
        latitude=msg.latitude,
        longitude=msg.longitude,
        created_at=_fmt_dt(msg.created_at),
        read_at=_fmt_dt(msg.read_at),
        is_mine=True,
        file_url=f"/messages/files/{msg.id}" if msg.file_path else None,
    )


# ─── POST /messages/file ──────────────────────────────────────────
@app.post("/messages/file", response_model=MessageResponse, status_code=201)
async def send_file_message(
    sender_email: str = Form(...),
    recipient_email: str = Form(...),
    file: UploadFile = File(...),
    caption: Optional[str] = Form(default=None),
    db: Session = Depends(get_db),
):
    """Send an image or document attachment between a volunteer and an NGO."""
    s_email = sender_email.strip().lower()
    r_email = recipient_email.strip().lower()
    sender_role, recipient_role = _validate_pair(s_email, r_email, db)

    # Validate caption
    clean_caption = caption.strip() if caption is not None else None
    if clean_caption:
        if len(clean_caption) > 2000:
            raise HTTPException(
                status_code=400,
                detail="Caption cannot exceed 2000 characters",
            )
    else:
        clean_caption = None

    # Block dangerous types by extension (case-insensitive)
    base_name = Path(file.filename or "file").name.strip() or "file"
    file_ext = Path(base_name).suffix.lower().lstrip(".")

    dangerous_extensions = {
        "exe", "bat", "cmd", "com", "msi", "scr", "sh",
        "app", "apk", "jar", "dmg", "pkg", "vbs", "ps1",
    }
    if file_ext in dangerous_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"File extension '.{file_ext}' is not allowed for security reasons",
        )

    # Max 10 MB: enforce by reading in chunks, stop and return 413 when exceeded. Reject empty files (400).
    chunk_size = 64 * 1024  # 64 KB
    max_file_size = 10 * 1024 * 1024  # 10 MB
    bytes_read = 0
    chunks = []

    while True:
        chunk = await file.read(chunk_size)
        if not chunk:
            break
        bytes_read += len(chunk)
        if bytes_read > max_file_size:
            raise HTTPException(
                status_code=413,
                detail="File size exceeds the 10 MB limit",
            )
        chunks.append(chunk)

    if bytes_read == 0:
        raise HTTPException(
            status_code=400,
            detail="Empty files cannot be uploaded",
        )

    # message_type = "image" if content_type starts with "image/", otherwise "document"
    content_type = file.content_type or "application/octet-stream"
    message_type = "image" if content_type.lower().startswith("image/") else "document"

    # Save to backend/uploads/messages/ with server-generated name (uuid + sanitized original extension)
    MESSAGES_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    raw_suffix = Path(base_name).suffix.lower()
    clean_suffix_ext = re.sub(r"[^a-zA-Z0-9]", "", raw_suffix)
    sanitized_ext = f".{clean_suffix_ext}" if clean_suffix_ext else ""
    server_filename = f"{uuid.uuid4().hex}{sanitized_ext}"

    dest = MESSAGES_UPLOAD_DIR / server_filename
    with open(dest, "wb") as f:
        f.write(b"".join(chunks))

    relative_path = f"messages/{server_filename}"

    msg = MessageDB(
        sender_email=s_email,
        sender_role=sender_role,
        recipient_email=r_email,
        recipient_role=recipient_role,
        message_type=message_type,
        body=clean_caption,
        file_path=relative_path,
        file_name=base_name,
        file_size=bytes_read,
        mime_type=content_type,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)

    return MessageResponse(
        id=msg.id,
        sender_email=msg.sender_email,
        sender_role=msg.sender_role,
        recipient_email=msg.recipient_email,
        recipient_role=msg.recipient_role,
        message_type=msg.message_type,
        body=msg.body,
        file_path=None,
        file_name=msg.file_name,
        file_size=msg.file_size,
        mime_type=msg.mime_type,
        latitude=msg.latitude,
        longitude=msg.longitude,
        created_at=_fmt_dt(msg.created_at),
        read_at=_fmt_dt(msg.read_at),
        is_mine=True,
        file_url=f"/messages/files/{msg.id}",
    )


# ─── POST /messages/location ──────────────────────────────────────
@app.post("/messages/location", response_model=MessageResponse, status_code=201)
def send_location_message(
    payload: LocationMessageSend,
    db: Session = Depends(get_db),
):
    """Send a location message between a volunteer and an NGO."""
    sender_role, recipient_role = _validate_pair(
        payload.sender_email,
        payload.recipient_email,
        db,
    )

    msg = MessageDB(
        sender_email=payload.sender_email,
        sender_role=sender_role,
        recipient_email=payload.recipient_email,
        recipient_role=recipient_role,
        message_type="location",
        body=None,
        latitude=payload.latitude,
        longitude=payload.longitude,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)

    return MessageResponse(
        id=msg.id,
        sender_email=msg.sender_email,
        sender_role=msg.sender_role,
        recipient_email=msg.recipient_email,
        recipient_role=msg.recipient_role,
        message_type=msg.message_type,
        body=None,
        file_path=None,
        file_name=None,
        file_size=None,
        mime_type=None,
        latitude=msg.latitude,
        longitude=msg.longitude,
        created_at=_fmt_dt(msg.created_at),
        read_at=_fmt_dt(msg.read_at),
        is_mine=True,
        file_url=None,
    )


# ─── GET /messages/files/{message_id} ─────────────────────────────
@app.get("/messages/files/{message_id}")
def get_message_file(
    message_id: int,
    email: str = Query(..., description="Requester email"),
    db: Session = Depends(get_db),
):
    """Download or view a message attachment securely."""
    msg = db.query(MessageDB).filter(MessageDB.id == message_id).first()
    if not msg or not msg.file_path:
        raise HTTPException(status_code=404, detail="File not found")

    req_email = email.strip().lower()
    if req_email not in (msg.sender_email.lower(), msg.recipient_email.lower()):
        raise HTTPException(
            status_code=403,
            detail="You do not have access to this conversation's files",
        )

    file_path = (UPLOAD_DIR / msg.file_path).resolve()
    messages_root = MESSAGES_UPLOAD_DIR.resolve()

    try:
        file_path.relative_to(messages_root)
    except ValueError:
        raise HTTPException(status_code=404, detail="File not found")

    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found on server")

    is_image = msg.message_type == "image" or (
        msg.mime_type and msg.mime_type.lower().startswith("image/")
    )
    disposition = "inline" if is_image else "attachment"

    return FileResponse(
        path=file_path,
        media_type=msg.mime_type,
        filename=msg.file_name or file_path.name,
        content_disposition_type=disposition,
    )


# ─── GET /conversations/{email} ───────────────────────────────────
@app.get("/conversations/{email}", response_model=list[ConversationEntry])
def list_conversations(
    email: str,
    db: Session = Depends(get_db),
):
    """List all conversations for a user, newest first."""

    my_role, _ = _resolve_role(email, db)
    email_lower = email.strip().lower()

    # All messages this user is involved in
    msgs = (
        db.query(MessageDB)
        .filter(
            (MessageDB.sender_email == email_lower)
            | (MessageDB.recipient_email == email_lower)
        )
        .order_by(MessageDB.created_at.asc())
        .all()
    )

    # Group by the "other" email
    convos: dict[str, dict] = {}

    for m in msgs:
        is_mine = m.sender_email == email_lower
        other_email = m.recipient_email if is_mine else m.sender_email

        if other_email not in convos:
            convos[other_email] = {
                "last_msg": m,
                "last_is_mine": is_mine,
                "unread": 0,
            }
        else:
            convos[other_email]["last_msg"] = m
            convos[other_email]["last_is_mine"] = is_mine

        # Unread = messages sent TO me that I haven't read
        if not is_mine and m.read_at is None:
            convos[other_email]["unread"] = convos[other_email].get("unread", 0) + 1

    # Build response with display names
    result: list[ConversationEntry] = []

    for other_email, info in convos.items():
        try:
            other_role, other_name = _resolve_role(other_email, db)
        except HTTPException:
            other_role, other_name = "unknown", other_email

        last_msg = info["last_msg"]
        if last_msg.message_type == "text":
            preview = (last_msg.body or "")[:80]
        elif last_msg.message_type == "image":
            preview = "Photo"
        elif last_msg.message_type == "document":
            preview = "Document"
        elif last_msg.message_type == "location":
            preview = "Location"
        else:
            preview = last_msg.message_type.capitalize()

        result.append(ConversationEntry(
            other_email=other_email,
            other_name=other_name,
            other_role=other_role,
            last_message_preview=preview,
            last_message_time=_fmt_dt(last_msg.created_at),
            last_message_from_me=info["last_is_mine"],
            unread_count=info["unread"],
        ))

    # Sort newest conversation first
    result.sort(key=lambda c: c.last_message_time, reverse=True)

    return result


# ─── GET /messages/{email}/with/{other_email} ─────────────────────
@app.get(
    "/messages/{email}/with/{other_email}",
    response_model=list[MessageResponse],
)
def get_thread(
    email: str,
    other_email: str,
    db: Session = Depends(get_db),
):
    """Return the full message thread between two users, oldest first."""

    _resolve_role(email, db)       # 404 if unknown
    _resolve_role(other_email, db)

    email_lower = email.strip().lower()
    other_lower = other_email.strip().lower()

    msgs = (
        db.query(MessageDB)
        .filter(
            (
                (MessageDB.sender_email == email_lower)
                & (MessageDB.recipient_email == other_lower)
            )
            | (
                (MessageDB.sender_email == other_lower)
                & (MessageDB.recipient_email == email_lower)
            )
        )
        .order_by(MessageDB.created_at.asc(), MessageDB.id.asc())
        .all()
    )

    return [
        MessageResponse(
            id=m.id,
            sender_email=m.sender_email,
            sender_role=m.sender_role,
            recipient_email=m.recipient_email,
            recipient_role=m.recipient_role,
            message_type=m.message_type,
            body=m.body,
            file_path=None,
            file_name=m.file_name,
            file_size=m.file_size,
            mime_type=m.mime_type,
            latitude=m.latitude,
            longitude=m.longitude,
            created_at=_fmt_dt(m.created_at),
            read_at=_fmt_dt(m.read_at),
            is_mine=(m.sender_email == email_lower),
            file_url=f"/messages/files/{m.id}" if m.file_path else None,
        )
        for m in msgs
    ]


# ─── PATCH /messages/read ─────────────────────────────────────────
@app.patch("/messages/read", response_model=MarkReadResponse)
def mark_messages_read(
    payload: MarkReadRequest,
    db: Session = Depends(get_db),
):
    """Mark all unread messages from other_email→reader_email as read."""

    _resolve_role(payload.reader_email, db)
    _resolve_role(payload.other_email, db)

    now = datetime.now(timezone.utc).replace(tzinfo=None)  # naive UTC for SQLite

    count = (
        db.query(MessageDB)
        .filter(
            MessageDB.sender_email == payload.other_email,
            MessageDB.recipient_email == payload.reader_email,
            MessageDB.read_at.is_(None),
        )
        .update({"read_at": now})
    )

    db.commit()

    return MarkReadResponse(updated=count)