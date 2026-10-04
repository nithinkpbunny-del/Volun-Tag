import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sklearn.metrics.pairwise import cosine_similarity
from sqlalchemy import func
from sqlalchemy.orm import Session
import numpy as np

try:
    from .database import Base, SessionLocal, engine, get_db
    from .db_models import ActivityDB, MessageDB, NGODB, IssueDB, VolunteerDB
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
        VolunteerMatchEntry, VolunteerMatchesResponse,
        MessageSend, MessageResponse, ConversationEntry,
        MarkReadRequest, MarkReadResponse,
    )
    from .matching import CATEGORY_KEYWORDS, CATEGORY_BOOST, compute_category_boost, classify_confidence, model
    from .seed_data import SEED_NGOS, SEED_VOLUNTEERS, run_seed
except ImportError:
    from database import Base, SessionLocal, engine, get_db
    from db_models import ActivityDB, MessageDB, NGODB, IssueDB, VolunteerDB
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
        VolunteerMatchEntry, VolunteerMatchesResponse,
        MessageSend, MessageResponse, ConversationEntry,
        MarkReadRequest, MarkReadResponse,
    )
    from matching import CATEGORY_KEYWORDS, CATEGORY_BOOST, compute_category_boost, classify_confidence, model
    from seed_data import SEED_NGOS, SEED_VOLUNTEERS, run_seed


logger = logging.getLogger(__name__)

UPLOAD_DIR = Path(__file__).resolve().parent / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

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

    if reporter_name is not None:
        reporter_name = reporter_name.strip() or None

    if contact_information is not None:
        contact_information = (
            contact_information.strip() or None
        )

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

    return NGOEventsResponse(
        ngo_name=ngo.name,
        total_events=len(events),
        events=events,
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
            "motto": n.motto,
            "category": n.category,
            "location": n.location,
            "urgency": n.urgency,
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

    vol_embedding = model.encode(
        [volunteer.skills]
    )

    candidate_embeddings = model.encode(
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

        final_score = min(score + boost, 1.0)

        matches.append(
            VolunteerMatchEntry(
                ngo_name=ngo.name,
                ngo_category=ngo.category,
                ngo_location=ngo.location,
                event_title=event.title if event else None,
                match_percentage=round(
                    final_score * 100, 1
                ),
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

    vol_embeddings = model.encode(
        volunteer_texts
    )

    ngo_embeddings = model.encode(
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

    # NGO cannot start a conversation
    if sender_role == "ngo":
        prior = db.query(MessageDB.id).filter(
            MessageDB.sender_email == payload.recipient_email,
            MessageDB.recipient_email == payload.sender_email,
        ).first()

        if not prior:
            raise HTTPException(
                status_code=403,
                detail=(
                    "NGOs cannot start a conversation. "
                    "A volunteer must send the first message."
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
        file_path=msg.file_path,
        file_name=msg.file_name,
        file_size=msg.file_size,
        mime_type=msg.mime_type,
        latitude=msg.latitude,
        longitude=msg.longitude,
        created_at=_fmt_dt(msg.created_at),
        read_at=_fmt_dt(msg.read_at),
        is_mine=True,
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
            file_path=m.file_path,
            file_name=m.file_name,
            file_size=m.file_size,
            mime_type=m.mime_type,
            latitude=m.latitude,
            longitude=m.longitude,
            created_at=_fmt_dt(m.created_at),
            read_at=_fmt_dt(m.read_at),
            is_mine=(m.sender_email == email_lower),
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