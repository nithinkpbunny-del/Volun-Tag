import os
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("OMP_NUM_THREADS", "2")
os.environ.setdefault("MKL_NUM_THREADS", "2")
os.environ.setdefault("HF_HUB_OFFLINE", "1")

import logging
import os
import re
import uuid
from datetime import datetime, timezone
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
    from .database import Base, SessionLocal, engine, get_db
    from .db_models import ActivityDB, ActivitySignupDB, MessageDB, NGODB, IssueDB, VolunteerDB
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
        EventVolunteerEntry, EventVolunteersResponse,
        VolunteerMatchEntry, VolunteerMatchesResponse,
        VolunteerEventEntry, JoinRequest, JoinResponse,
        MessageSend, LocationMessageSend, MessageResponse, ConversationEntry,
        MarkReadRequest, MarkReadResponse,
    )
    from .matching import CATEGORY_KEYWORDS, CATEGORY_BOOST, compute_category_boost, compute_location_boost, compute_match_level, classify_confidence, encode_texts
    from .seed_data import SEED_NGOS, SEED_VOLUNTEERS, run_seed
except ImportError:
    from database import Base, SessionLocal, engine, get_db
    from db_models import ActivityDB, ActivitySignupDB, MessageDB, NGODB, IssueDB, VolunteerDB
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
        EventVolunteerEntry, EventVolunteersResponse,
        VolunteerMatchEntry, VolunteerMatchesResponse,
        VolunteerEventEntry, JoinRequest, JoinResponse,
        MessageSend, LocationMessageSend, MessageResponse, ConversationEntry,
        MarkReadRequest, MarkReadResponse,
    )
    from matching import CATEGORY_KEYWORDS, CATEGORY_BOOST, compute_category_boost, compute_location_boost, compute_match_level, classify_confidence, encode_texts
    from seed_data import SEED_NGOS, SEED_VOLUNTEERS, run_seed


logger = logging.getLogger(__name__)

UPLOAD_DIR = Path(__file__).resolve().parent / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MESSAGES_UPLOAD_DIR = UPLOAD_DIR / "messages"
MESSAGES_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

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

MAX_IMAGES = 6
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10 MB per file

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


# ─── Startup / Seed Data ───────────────────────────────────────────
@app.on_event("startup")
def seed_data():
    """Load sample data on server startup."""
    run_seed()


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

    return update_issue_status(
        issue,
        status_update.status,
        db,
    )


@app.delete(
    "/issues/{complaint_id}",
    response_model=IssueDeleteResponse,
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

    db.add(
        VolunteerDB(
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
    )

    db.commit()

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

    event_responses = []
    for ev in events:
        item = EventResponse.model_validate(ev)
        item.joined_count = joined_counts.get(ev.id, 0)
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

    rows = (
        db.query(ActivitySignupDB, VolunteerDB)
        .join(
            VolunteerDB,
            ActivitySignupDB.volunteer_id == VolunteerDB.id,
        )
        .filter(ActivitySignupDB.activity_id == event.id)
        .order_by(ActivitySignupDB.created_at.asc())
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
            # Attendance tracking is not built yet.
            events_attended=0,
            joined_at=signup.created_at,
        )
        for signup, vol in rows
    ]

    return EventVolunteersResponse(
        event_id=event.id,
        title=event.title,
        status=event.status,
        spots_available=event.spots_available,
        joined_count=len(volunteers),
        volunteers=volunteers,
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

    matched: list[NGOIssueEntry] = []

    for issue in all_issues:
        recs = issue.recommended_ngos
        if not recs or not isinstance(recs, list):
            continue

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

        joined = db.query(func.count(ActivitySignupDB.id)).filter(
            ActivitySignupDB.activity_id == event.id,
        ).scalar()

        if joined < event.spots_available:
            raise HTTPException(
                status_code=400,
                detail="Not enough volunteers have joined yet",
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

    for field, value in event_update.model_dump(exclude_unset=True).items():
        setattr(event, field, value)

    db.commit()
    db.refresh(event)

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
    match_texts = [
        c["match_text"]
        for c in candidates
    ]

    vol_embedding = encode_texts(
        [volunteer.skills]
    )

    candidate_embeddings = encode_texts(
        match_texts
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

    # Batch-encode all event required_skills texts.
    event_texts = [
        ev.required_skills.strip() for ev, _ in events
    ]

    vol_embedding = encode_texts([volunteer.skills])
    event_embeddings = encode_texts(event_texts)

    scores = cosine_similarity(
        vol_embedding,
        event_embeddings,
    )[0]

    # Pre-fetch signup rows for this volunteer so the "joined" flag is O(1).
    joined_ids = set(
        row.activity_id
        for row in db.query(ActivitySignupDB.activity_id).filter(
            ActivitySignupDB.volunteer_id == volunteer.id,
        ).all()
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
                joined=ev.id in joined_ids,
            )
        )

    results.sort(
        key=lambda m: m.match_percentage,
        reverse=True,
    )

    return results


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

    volunteer_texts = [
        v.skills
        for v in volunteers
    ]

    ngo_texts = [
        n.motto or ""
        for n in filtered_ngos
    ]

    vol_embeddings = encode_texts(
        volunteer_texts
    )

    ngo_embeddings = encode_texts(
        ngo_texts
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