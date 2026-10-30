"""Admin console routes: login, session, proof reviews, and read-only platform views."""

import json
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, func, or_
from sqlalchemy.orm import Session

try:
    from .admin_auth import (
        check_login_allowed,
        create_session,
        log_admin_action,
        raise_lockout_started,
        record_failed_login,
        require_admin,
        reset_failed_logins,
        verify_password,
    )
    from .database import get_db
    from .db_models import (
        ActivityDB, ActivitySignupDB, AdminActionDB, AdminSessionDB, IssueDB,
        IssueResolutionDB, MessageDB, NGODB, VolunteerDB,
    )
    from .issue_service import get_issue_by_complaint_id
    from .schemas import (
        AdminActionEntry, AdminActivityItem, AdminConversation,
        AdminConversationSummary, AdminEventCounts, AdminEventDetail,
        AdminEventVolunteer, AdminIssueCounts, AdminLoginRequest,
        AdminLoginResponse, AdminMatchedIssue, AdminMeResponse, AdminMessage,
        AdminNGOCounts, AdminNGODetail, AdminNGODocument, AdminNGOEvent,
        AdminNGOListItem, AdminNGOProblems, AdminNGOProfile, AdminNGOProof,
        AdminNGOStats, AdminOtherResolution, AdminOverview, AdminParticipant,
        AdminResolutionDetail, AdminResolutionIssue, AdminResolutionNGO,
        AdminSignupCounts, AdminVolunteerActivity, AdminVolunteerDetail,
        AdminVolunteerListItem, AdminVolunteerProblem, AdminVolunteerProfile,
        AdminVolunteerStats,
    )
except ImportError:
    from admin_auth import (
        check_login_allowed,
        create_session,
        log_admin_action,
        raise_lockout_started,
        record_failed_login,
        require_admin,
        reset_failed_logins,
        verify_password,
    )
    from database import get_db
    from db_models import (
        ActivityDB, ActivitySignupDB, AdminActionDB, AdminSessionDB, IssueDB,
        IssueResolutionDB, MessageDB, NGODB, VolunteerDB,
    )
    from issue_service import get_issue_by_complaint_id
    from schemas import (
        AdminActionEntry, AdminActivityItem, AdminConversation,
        AdminConversationSummary, AdminEventCounts, AdminEventDetail,
        AdminEventVolunteer, AdminIssueCounts, AdminLoginRequest,
        AdminLoginResponse, AdminMatchedIssue, AdminMeResponse, AdminMessage,
        AdminNGOCounts, AdminNGODetail, AdminNGODocument, AdminNGOEvent,
        AdminNGOListItem, AdminNGOProblems, AdminNGOProfile, AdminNGOProof,
        AdminNGOStats, AdminOtherResolution, AdminOverview, AdminParticipant,
        AdminResolutionDetail, AdminResolutionIssue, AdminResolutionNGO,
        AdminSignupCounts, AdminVolunteerActivity, AdminVolunteerDetail,
        AdminVolunteerListItem, AdminVolunteerProblem, AdminVolunteerProfile,
        AdminVolunteerStats,
    )


router = APIRouter(prefix="/admin", tags=["admin"])

RECENT_ACTIVITY_LIMIT = 15
ACTIONS_LIMIT_MAX = 200

# Registration document columns on ngos, with the labels used at registration.
NGO_DOCUMENTS = (
    ("registration_certificate", "Registration Certificate"),
    ("pan_card", "PAN Card"),
    ("cert_12a", "12A Certificate"),
    ("cert_80g", "80G Certificate"),
    ("cert_fcra", "FCRA Certificate"),
    ("trust_deed", "Trust Deed"),
    ("society_registration_certificate", "Society Registration Certificate"),
    ("society_moa", "Society MOA"),
    ("section8_incorporation_certificate", "Section 8 Incorporation Certificate"),
    ("section8_moa_aoa", "Section 8 MOA/AOA"),
)
NGO_DOCUMENT_KEYS = dict(NGO_DOCUMENTS)
WORK_IMAGE_KEY = re.compile(r"work_image_(0|[1-9][0-9]*)")


def _fmt_utc(dt) -> str:
    """Format a naive UTC datetime as ISO-8601 with a trailing Z."""
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _app():
    """Return the main module for its shared helpers (is_completed, UPLOAD_DIR, ...).

    main.py imports this router, so a top-level import would be circular;
    by the time a request is handled, main is fully loaded.
    """
    try:
        from . import main
    except ImportError:
        import main
    return main


def _event_bucket(event: ActivityDB, completed: bool) -> str:
    """"cancelled", "completed" or "upcoming" (Filled events count as upcoming until completed)."""
    if event.status == "Cancelled":
        return "cancelled"
    return "completed" if completed else "upcoming"


def _event_status_label(event: ActivityDB, completed: bool) -> str:
    if event.status == "Cancelled":
        return "Cancelled"
    if completed:
        return "Completed"
    if event.status == "Filled":
        return "Filled"
    return "Upcoming"


def _average(values: list) -> Optional[float]:
    return round(sum(values) / len(values), 2) if values else None


def _like_pattern(term: str) -> str:
    """Case-insensitive LIKE pattern for a user search term, with wildcards escaped."""
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _ngo_counts(db: Session, ngo_ids: list[int]) -> dict[int, dict[str, int]]:
    """Event and proof counts per NGO id."""

    is_completed = _app().is_completed

    counts = {
        ngo_id: {
            "events_total": 0,
            "events_upcoming": 0,
            "events_completed": 0,
            "events_cancelled": 0,
            "problems_solved": 0,
            "proofs_pending": 0,
        }
        for ngo_id in ngo_ids
    }

    if not ngo_ids:
        return counts

    for event in db.query(ActivityDB).filter(ActivityDB.ngo_id.in_(ngo_ids)).all():
        entry = counts[event.ngo_id]
        entry["events_total"] += 1
        entry[f"events_{_event_bucket(event, is_completed(event))}"] += 1

    proof_rows = (
        db.query(
            IssueResolutionDB.ngo_id,
            IssueResolutionDB.status,
            func.count(IssueResolutionDB.id),
        )
        .filter(
            IssueResolutionDB.ngo_id.in_(ngo_ids),
            IssueResolutionDB.status.in_(["Approved", "Under evaluation"]),
        )
        .group_by(IssueResolutionDB.ngo_id, IssueResolutionDB.status)
        .all()
    )

    for ngo_id, status, n in proof_rows:
        key = "problems_solved" if status == "Approved" else "proofs_pending"
        counts[ngo_id][key] = n

    return counts


def _lookup_people(db: Session, emails: list[str]) -> dict[str, tuple[str, str]]:
    """Map lowercased email -> (name, role) for volunteers and NGOs."""

    if not emails:
        return {}

    people = {}

    for email, name in db.query(NGODB.email, NGODB.name).filter(
        NGODB.email.isnot(None),
        func.lower(NGODB.email).in_(emails),
    ):
        people[email.strip().lower()] = (name, "ngo")

    # Volunteers win on a clash, matching the messaging role lookup.
    for email, name in db.query(VolunteerDB.email, VolunteerDB.name).filter(
        func.lower(VolunteerDB.email).in_(emails),
    ):
        people[email.strip().lower()] = (name, "volunteer")

    return people


def _stored_ngo_file(ngo: NGODB, key: str) -> Optional[str]:
    """Stored file name for a whitelisted document key, or None."""

    if key in NGO_DOCUMENT_KEYS:
        return getattr(ngo, key)

    match = WORK_IMAGE_KEY.fullmatch(key)
    if match:
        images = ngo.work_images if isinstance(ngo.work_images, list) else []
        index = int(match.group(1))
        return images[index] if index < len(images) else None

    return None


def _upload_exists(stored_name) -> bool:
    app = _app()
    path = app.safe_upload_path(app.UPLOAD_DIR, stored_name)
    return bool(path and path.is_file())


# ─── Login / Logout ───────────────────────────────────────────────
@router.post("/login", response_model=AdminLoginResponse)
def admin_login(
    payload: AdminLoginRequest,
    db: Session = Depends(get_db),
):
    """Exchange the admin password for a bearer token valid for 8 hours."""

    check_login_allowed()

    if not verify_password(payload.password):
        locked = record_failed_login()

        log_admin_action(db, "login_failed", "session", None, {"locked_out": locked})
        db.commit()

        if locked:
            raise_lockout_started()

        raise HTTPException(
            status_code=401,
            detail="Incorrect password",
        )

    reset_failed_logins()

    token, session = create_session(db)

    log_admin_action(db, "login", "session", session.id, {})
    db.commit()

    return AdminLoginResponse(
        token=token,
        expires_at=_fmt_utc(session.expires_at),
    )


@router.post("/logout")
def admin_logout(
    session: AdminSessionDB = Depends(require_admin),
    db: Session = Depends(get_db),
):
    log_admin_action(db, "logout", "session", session.id, {})
    db.delete(session)
    db.commit()

    return {"ok": True}


@router.get("/me", response_model=AdminMeResponse)
def admin_me(
    session: AdminSessionDB = Depends(require_admin),
):
    return AdminMeResponse(ok=True, expires_at=_fmt_utc(session.expires_at))


# ─── Proof Review Detail ──────────────────────────────────────────
@router.get(
    "/resolutions/{resolution_id}",
    response_model=AdminResolutionDetail,
    dependencies=[Depends(require_admin)],
)
def get_admin_resolution(
    resolution_id: int,
    db: Session = Depends(get_db),
):
    """One proof with its NGO, its issue, and every other proof for that issue."""

    resolution = db.query(IssueResolutionDB).filter(
        IssueResolutionDB.id == resolution_id,
    ).first()

    if not resolution:
        raise HTTPException(
            status_code=404,
            detail=f"Resolution '{resolution_id}' not found",
        )

    ngo = db.query(NGODB).filter(NGODB.id == resolution.ngo_id).first()
    issue = get_issue_by_complaint_id(db, resolution.complaint_id)

    others = (
        db.query(IssueResolutionDB, NGODB.name)
        .outerjoin(NGODB, IssueResolutionDB.ngo_id == NGODB.id)
        .filter(
            IssueResolutionDB.complaint_id == resolution.complaint_id,
            IssueResolutionDB.id != resolution.id,
        )
        .order_by(
            IssueResolutionDB.submitted_at.desc(),
            IssueResolutionDB.id.desc(),
        )
        .all()
    )

    # Fields are copied one by one so no password or stored file path can leak.
    return AdminResolutionDetail(
        id=resolution.id,
        complaint_id=resolution.complaint_id,
        ngo_id=resolution.ngo_id,
        solution_type=resolution.solution_type,
        solution_text=resolution.solution_text,
        document_name=resolution.document_name,
        status=resolution.status,
        reject_reason=resolution.reject_reason,
        submitted_at=resolution.submitted_at,
        decided_at=resolution.decided_at,
        ngo=AdminResolutionNGO(
            id=ngo.id,
            name=ngo.name,
            email=ngo.email,
            location=ngo.location,
            verification_status=ngo.verification_status,
        ) if ngo else None,
        issue=AdminResolutionIssue(
            complaint_id=issue.complaint_id,
            reporter_name=issue.reporter_name,
            reporter_email=issue.reporter_email,
            location=issue.location,
            user_description=issue.user_description,
            status=issue.status,
            created_at=issue.created_at,
            image_count=len(issue.image_paths) if issue.image_paths else 0,
        ) if issue else None,
        other_resolutions=[
            AdminOtherResolution(
                id=other.id,
                ngo_name=ngo_name,
                status=other.status,
                submitted_at=other.submitted_at,
            )
            for other, ngo_name in others
        ],
    )


# ─── Overview ─────────────────────────────────────────────────────
def _recent_activity(db: Session, limit: int) -> list[AdminActivityItem]:
    """Newest items across events, signups, issues and proofs."""

    items: list[AdminActivityItem] = []

    events = (
        db.query(ActivityDB, NGODB.name)
        .outerjoin(NGODB, ActivityDB.ngo_id == NGODB.id)
        .order_by(ActivityDB.created_at.desc(), ActivityDB.id.desc())
        .limit(limit)
        .all()
    )
    for event, ngo_name in events:
        items.append(AdminActivityItem(
            type="event_created",
            text=f'{ngo_name or "An NGO"} created the event "{event.title}"',
            at=event.created_at,
            ref_type="event",
            ref_id=str(event.id),
        ))

    signups = (
        db.query(ActivitySignupDB, VolunteerDB.name, ActivityDB.title)
        .outerjoin(VolunteerDB, ActivitySignupDB.volunteer_id == VolunteerDB.id)
        .outerjoin(ActivityDB, ActivitySignupDB.activity_id == ActivityDB.id)
        .order_by(ActivitySignupDB.created_at.desc(), ActivitySignupDB.id.desc())
        .limit(limit)
        .all()
    )
    for signup, volunteer_name, title in signups:
        items.append(AdminActivityItem(
            type="signup",
            text=f'{volunteer_name or "A volunteer"} signed up for "{title or "an event"}"',
            at=signup.created_at,
            ref_type="event",
            ref_id=str(signup.activity_id),
        ))

    issues = (
        db.query(IssueDB)
        .order_by(IssueDB.created_at.desc(), IssueDB.id.desc())
        .limit(limit)
        .all()
    )
    for issue in issues:
        items.append(AdminActivityItem(
            type="issue_reported",
            text=f"{issue.reporter_name or 'A volunteer'} reported {issue.complaint_id}",
            at=issue.created_at,
            ref_type="issue",
            ref_id=issue.complaint_id,
        ))

    submitted = (
        db.query(IssueResolutionDB, NGODB.name)
        .outerjoin(NGODB, IssueResolutionDB.ngo_id == NGODB.id)
        .order_by(IssueResolutionDB.submitted_at.desc(), IssueResolutionDB.id.desc())
        .limit(limit)
        .all()
    )
    for res, ngo_name in submitted:
        items.append(AdminActivityItem(
            type="proof_submitted",
            text=f"{ngo_name or 'An NGO'} submitted proof for {res.complaint_id}",
            at=res.submitted_at,
            ref_type="resolution",
            ref_id=str(res.id),
        ))

    decided = (
        db.query(IssueResolutionDB, NGODB.name)
        .outerjoin(NGODB, IssueResolutionDB.ngo_id == NGODB.id)
        .filter(IssueResolutionDB.decided_at.isnot(None))
        .order_by(IssueResolutionDB.decided_at.desc(), IssueResolutionDB.id.desc())
        .limit(limit)
        .all()
    )
    for res, ngo_name in decided:
        items.append(AdminActivityItem(
            type="proof_decided",
            text=(
                f"Proof from {ngo_name or 'an NGO'} for {res.complaint_id} "
                f"was {res.status.lower()}"
            ),
            at=res.decided_at,
            ref_type="resolution",
            ref_id=str(res.id),
        ))

    items.sort(key=lambda item: item.at, reverse=True)

    return items[:limit]


@router.get(
    "/overview",
    response_model=AdminOverview,
    dependencies=[Depends(require_admin)],
)
def get_admin_overview(
    db: Session = Depends(get_db),
):
    """Platform totals and the newest activity."""

    is_completed = _app().is_completed

    ngo_by_status = dict(
        db.query(NGODB.verification_status, func.count(NGODB.id))
        .group_by(NGODB.verification_status)
        .all()
    )

    event_counts = {"upcoming": 0, "completed": 0, "cancelled": 0}
    for event in db.query(ActivityDB).all():
        event_counts[_event_bucket(event, is_completed(event))] += 1

    issue_by_status = dict(
        db.query(IssueDB.status, func.count(IssueDB.id))
        .group_by(IssueDB.status)
        .all()
    )
    issues_total = sum(issue_by_status.values())
    reported = issue_by_status.get("Reported", 0)
    under_evaluation = issue_by_status.get("Under evaluation", 0)
    resolved = issue_by_status.get("Resolved", 0)

    return AdminOverview(
        ngos=AdminNGOCounts(
            total=sum(ngo_by_status.values()),
            by_status=ngo_by_status,
        ),
        volunteers_total=db.query(func.count(VolunteerDB.id)).scalar(),
        events=AdminEventCounts(**event_counts),
        signups=AdminSignupCounts(
            total=db.query(func.count(ActivitySignupDB.id)).scalar(),
            approved=db.query(func.count(ActivitySignupDB.id)).filter(
                ActivitySignupDB.approved_at.isnot(None),
            ).scalar(),
            attended=db.query(func.count(ActivitySignupDB.id)).filter(
                ActivitySignupDB.attendance_status == "attended",
            ).scalar(),
        ),
        issues=AdminIssueCounts(
            total=issues_total,
            reported=reported,
            under_evaluation=under_evaluation,
            resolved=resolved,
            other=issues_total - reported - under_evaluation - resolved,
        ),
        proofs_pending=db.query(func.count(IssueResolutionDB.id)).filter(
            IssueResolutionDB.status == "Under evaluation",
        ).scalar(),
        messages_total=db.query(func.count(MessageDB.id)).scalar(),
        recent_activity=_recent_activity(db, RECENT_ACTIVITY_LIMIT),
    )


# ─── NGOs ─────────────────────────────────────────────────────────
@router.get(
    "/ngos",
    response_model=list[AdminNGOListItem],
    dependencies=[Depends(require_admin)],
)
def list_admin_ngos(
    search: str = Query(default=""),
    status: str = Query(default=""),
    db: Session = Depends(get_db),
):
    """NGOs sorted by name, filtered by a search term and verification status."""

    query = db.query(NGODB)

    term = search.strip().lower()
    if term:
        pattern = _like_pattern(term)
        query = query.filter(or_(
            *[
                func.lower(func.coalesce(column, "")).like(pattern, escape="\\")
                for column in (NGODB.name, NGODB.email, NGODB.category, NGODB.location)
            ]
        ))

    if status.strip():
        query = query.filter(NGODB.verification_status == status.strip())

    ngos = query.order_by(func.lower(NGODB.name), NGODB.id).all()
    counts = _ngo_counts(db, [ngo.id for ngo in ngos])

    return [
        AdminNGOListItem(
            id=ngo.id,
            name=ngo.name,
            email=ngo.email,
            category=ngo.category,
            location=ngo.location,
            verification_status=ngo.verification_status,
            **counts[ngo.id],
        )
        for ngo in ngos
    ]


def _ngo_conversations(db: Session, email: Optional[str]) -> list[AdminConversationSummary]:
    """One summary per party this email has exchanged messages with, newest first."""

    if not email:
        return []

    me = email.strip().lower()

    messages = (
        db.query(MessageDB)
        .filter(or_(
            func.lower(MessageDB.sender_email) == me,
            func.lower(MessageDB.recipient_email) == me,
        ))
        .order_by(MessageDB.created_at.asc(), MessageDB.id.asc())
        .all()
    )

    threads: dict[str, dict] = {}

    for message in messages:
        sent = message.sender_email.strip().lower() == me
        other = (message.recipient_email if sent else message.sender_email).strip().lower()
        other_role = message.recipient_role if sent else message.sender_role

        thread = threads.setdefault(other, {"count": 0, "last": None, "role": other_role})
        thread["count"] += 1
        thread["last"] = message

    people = _lookup_people(db, list(threads))

    summaries = []
    for other, thread in threads.items():
        name, role = people.get(other, (other, thread["role"]))
        last = thread["last"]

        summaries.append(AdminConversationSummary(
            email=other,
            name=name,
            role=role,
            message_count=thread["count"],
            last_message_at=last.created_at,
        ))

    summaries.sort(key=lambda s: s.last_message_at, reverse=True)

    return summaries


@router.get(
    "/ngos/{ngo_id}",
    response_model=AdminNGODetail,
    dependencies=[Depends(require_admin)],
)
def get_admin_ngo(
    ngo_id: int,
    db: Session = Depends(get_db),
):
    """One NGO: profile, documents, stats, events, problems and conversations."""

    app = _app()

    ngo = db.query(NGODB).filter(NGODB.id == ngo_id).first()

    if not ngo:
        raise HTTPException(
            status_code=404,
            detail=f"NGO '{ngo_id}' not found",
        )

    # ── Documents ──
    documents = [
        AdminNGODocument(
            key=key,
            label=label,
            available=bool(getattr(ngo, key)) and _upload_exists(getattr(ngo, key)),
        )
        for key, label in NGO_DOCUMENTS
    ]

    work_images = ngo.work_images if isinstance(ngo.work_images, list) else []
    for index, stored_name in enumerate(work_images):
        documents.append(AdminNGODocument(
            key=f"work_image_{index}",
            label=f"Work photo {index + 1}",
            available=_upload_exists(stored_name),
        ))

    # ── Events and their signups ──
    events = (
        db.query(ActivityDB)
        .filter(ActivityDB.ngo_id == ngo.id)
        .order_by(ActivityDB.created_at.desc(), ActivityDB.id.desc())
        .all()
    )

    signups_by_event: dict[int, list[ActivitySignupDB]] = {event.id: [] for event in events}
    if events:
        for signup in db.query(ActivitySignupDB).filter(
            ActivitySignupDB.activity_id.in_(list(signups_by_event)),
        ):
            signups_by_event[signup.activity_id].append(signup)

    event_entries = []
    engaged_volunteers = set()
    ratings_given = []

    for event in events:
        signups = signups_by_event[event.id]
        attended = [s for s in signups if s.attendance_status == "attended"]
        ratings = [s.rating for s in attended if s.rating is not None]

        engaged_volunteers.update(s.volunteer_id for s in signups if s.approved_at is not None)
        ratings_given.extend(ratings)

        event_entries.append(AdminNGOEvent(
            id=event.id,
            title=event.title,
            event_date=event.event_date,
            status_label=_event_status_label(event, app.is_completed(event)),
            spots_available=event.spots_available,
            signups=len(signups),
            approved=sum(1 for s in signups if s.approved_at is not None),
            attended=len(attended),
            average_rating=_average(ratings),
        ))

    # ── Problems ──
    open_issues = (
        db.query(IssueDB)
        .filter(IssueDB.status.notin_(["Resolved", "Rejected"]))
        .order_by(IssueDB.created_at.desc(), IssueDB.id.desc())
        .all()
    )

    proofs = (
        db.query(IssueResolutionDB)
        .filter(IssueResolutionDB.ngo_id == ngo.id)
        .order_by(IssueResolutionDB.submitted_at.desc(), IssueResolutionDB.id.desc())
        .all()
    )

    counts = _ngo_counts(db, [ngo.id])[ngo.id]

    return AdminNGODetail(
        id=ngo.id,
        profile=AdminNGOProfile(
            name=ngo.name,
            email=ngo.email,
            contact_number=ngo.contact_number,
            category=ngo.category,
            location=ngo.location,
            motto=ngo.motto,
            legal_structure=ngo.legal_structure,
            year_founded=ngo.year_founded,
            website_url=ngo.website_url,
            verification_status=ngo.verification_status,
            verification_notes=ngo.verification_notes,
            verified_at=ngo.verified_at,
        ),
        documents=documents,
        stats=AdminNGOStats(
            **counts,
            volunteers_engaged=len(engaged_volunteers),
            average_rating_given=_average(ratings_given),
        ),
        events=event_entries,
        problems=AdminNGOProblems(
            matched_open=[
                AdminMatchedIssue(
                    complaint_id=issue.complaint_id,
                    location=issue.location,
                    status=issue.status,
                    created_at=issue.created_at,
                )
                for issue in open_issues
                if app.issue_matches_ngo(issue, ngo)
            ],
            proofs=[
                AdminNGOProof(
                    id=proof.id,
                    complaint_id=proof.complaint_id,
                    status=proof.status,
                    solution_type=proof.solution_type,
                    submitted_at=proof.submitted_at,
                    decided_at=proof.decided_at,
                )
                for proof in proofs
            ],
        ),
        conversations=_ngo_conversations(db, ngo.email),
    )


@router.get(
    "/ngos/{ngo_id}/documents/{key}",
    dependencies=[Depends(require_admin)],
)
def get_admin_ngo_document(
    ngo_id: int,
    key: str,
    db: Session = Depends(get_db),
):
    """Serve one whitelisted registration document or work photo of an NGO."""

    ngo = db.query(NGODB).filter(NGODB.id == ngo_id).first()

    if not ngo:
        raise HTTPException(
            status_code=404,
            detail=f"NGO '{ngo_id}' not found",
        )

    stored_name = _stored_ngo_file(ngo, key)

    if not stored_name:
        raise HTTPException(status_code=404, detail="File not found")

    app = _app()

    # serve_stored_file resolves the name with safe_upload_path and 404s if unsafe or missing.
    return app.serve_stored_file(app.UPLOAD_DIR, stored_name)


# ─── Volunteers ───────────────────────────────────────────────────
def _signup_status(signup: ActivitySignupDB, completed: bool) -> str:
    """Same rule as GET /admin/events/{id}: approved, else not selected once the event is over."""
    if signup.approved_at is not None:
        return "Approved"
    if completed:
        return "Not selected"
    return "Waiting for approval"


def _volunteer_counts(db: Session, volunteers: list[VolunteerDB]) -> dict[int, dict[str, int]]:
    """Signup and reported-issue counts per volunteer id, with one grouped query each."""

    counts = {
        volunteer.id: {
            "signups_total": 0,
            "signups_approved": 0,
            "events_attended": 0,
            "events_not_attended": 0,
            "issues_reported": 0,
            "issues_resolved": 0,
        }
        for volunteer in volunteers
    }

    if not volunteers:
        return counts

    signup_rows = (
        db.query(
            ActivitySignupDB.volunteer_id,
            func.count(ActivitySignupDB.id),
            func.sum(case((ActivitySignupDB.approved_at.isnot(None), 1), else_=0)),
            func.sum(case((ActivitySignupDB.attendance_status == "attended", 1), else_=0)),
            func.sum(case((ActivitySignupDB.attendance_status == "not_attended", 1), else_=0)),
        )
        .filter(ActivitySignupDB.volunteer_id.in_(list(counts)))
        .group_by(ActivitySignupDB.volunteer_id)
        .all()
    )

    for volunteer_id, total, approved, attended, not_attended in signup_rows:
        entry = counts[volunteer_id]
        entry["signups_total"] = total
        entry["signups_approved"] = approved or 0
        entry["events_attended"] = attended or 0
        entry["events_not_attended"] = not_attended or 0

    # Issues link to their reporter by email only; issues without one count for nobody.
    id_by_email = {
        volunteer.email.strip().lower(): volunteer.id
        for volunteer in volunteers
        if volunteer.email and volunteer.email.strip()
    }

    if id_by_email:
        reporter = func.lower(func.trim(IssueDB.reporter_email))

        issue_rows = (
            db.query(
                reporter,
                func.count(IssueDB.id),
                func.sum(case((IssueDB.status == "Resolved", 1), else_=0)),
            )
            .filter(reporter.in_(list(id_by_email)))
            .group_by(reporter)
            .all()
        )

        for email, reported, resolved in issue_rows:
            entry = counts[id_by_email[email]]
            entry["issues_reported"] = reported
            entry["issues_resolved"] = resolved or 0

    return counts


@router.get(
    "/volunteers",
    response_model=list[AdminVolunteerListItem],
    dependencies=[Depends(require_admin)],
)
def list_admin_volunteers(
    search: str = Query(default=""),
    db: Session = Depends(get_db),
):
    """Volunteers sorted by name, filtered by a search term."""

    query = db.query(VolunteerDB)

    term = search.strip().lower()
    if term:
        pattern = _like_pattern(term)
        query = query.filter(or_(
            *[
                func.lower(func.coalesce(column, "")).like(pattern, escape="\\")
                for column in (
                    VolunteerDB.name,
                    VolunteerDB.email,
                    VolunteerDB.location,
                    VolunteerDB.skills,
                )
            ]
        ))

    volunteers = query.order_by(func.lower(VolunteerDB.name), VolunteerDB.id).all()
    counts = _volunteer_counts(db, volunteers)

    return [
        AdminVolunteerListItem(
            id=volunteer.id,
            name=volunteer.name,
            email=volunteer.email,
            location=volunteer.location,
            signups_total=counts[volunteer.id]["signups_total"],
            signups_approved=counts[volunteer.id]["signups_approved"],
            events_attended=counts[volunteer.id]["events_attended"],
            issues_reported=counts[volunteer.id]["issues_reported"],
        )
        for volunteer in volunteers
    ]


@router.get(
    "/volunteers/{volunteer_id}",
    response_model=AdminVolunteerDetail,
    dependencies=[Depends(require_admin)],
)
def get_admin_volunteer(
    volunteer_id: int,
    db: Session = Depends(get_db),
):
    """One volunteer: profile, stats, event activity, reported problems and conversations."""

    app = _app()

    volunteer = db.query(VolunteerDB).filter(VolunteerDB.id == volunteer_id).first()

    if not volunteer:
        raise HTTPException(
            status_code=404,
            detail=f"Volunteer '{volunteer_id}' not found",
        )

    counts = _volunteer_counts(db, [volunteer])[volunteer.id]

    # ── Event activity ──
    signup_rows = (
        db.query(ActivitySignupDB, ActivityDB, NGODB.name)
        .outerjoin(ActivityDB, ActivitySignupDB.activity_id == ActivityDB.id)
        .outerjoin(NGODB, ActivityDB.ngo_id == NGODB.id)
        .filter(ActivitySignupDB.volunteer_id == volunteer.id)
        .order_by(ActivitySignupDB.created_at.desc(), ActivitySignupDB.id.desc())
        .all()
    )

    activity = []
    ratings_received = []

    for signup, event, ngo_name in signup_rows:
        completed = event is not None and app.is_completed(event)

        if signup.attendance_status == "attended" and signup.rating is not None:
            ratings_received.append(signup.rating)

        activity.append(AdminVolunteerActivity(
            event_id=signup.activity_id,
            event_title=event.title if event else None,
            ngo_id=event.ngo_id if event else None,
            ngo_name=ngo_name,
            event_date=event.event_date if event else None,
            event_status_label=_event_status_label(event, completed) if event else None,
            signup_status=_signup_status(signup, completed),
            attendance_status=signup.attendance_status,
            rating=signup.rating,
            feedback=signup.feedback,
            signed_up_at=signup.created_at,
        ))

    # ── Reported problems ──
    email = (volunteer.email or "").strip().lower()

    issues = []
    if email:
        issues = (
            db.query(IssueDB)
            .filter(func.lower(func.trim(IssueDB.reporter_email)) == email)
            .order_by(IssueDB.created_at.desc(), IssueDB.id.desc())
            .all()
        )

    solved = app.approved_resolutions(db, [issue.complaint_id for issue in issues])

    return AdminVolunteerDetail(
        id=volunteer.id,
        profile=AdminVolunteerProfile(
            name=volunteer.name,
            email=volunteer.email,
            contact_number=volunteer.contact_number,
            age=volunteer.age,
            designation=volunteer.designation,
            gender=volunteer.gender,
            skills=volunteer.skills,
            location=volunteer.location,
            availability=volunteer.availability,
            experience=volunteer.experience,
        ),
        stats=AdminVolunteerStats(
            **counts,
            average_rating_received=_average(ratings_received),
        ),
        activity=activity,
        problems=[
            AdminVolunteerProblem(
                complaint_id=issue.complaint_id,
                location=issue.location,
                status=issue.status,
                created_at=issue.created_at,
                solved_by=solved[issue.complaint_id][1] if issue.complaint_id in solved else None,
            )
            for issue in issues
        ],
        conversations=_ngo_conversations(db, volunteer.email),
    )


# ─── Events ───────────────────────────────────────────────────────
@router.get(
    "/events/{event_id}",
    response_model=AdminEventDetail,
    dependencies=[Depends(require_admin)],
)
def get_admin_event(
    event_id: int,
    db: Session = Depends(get_db),
):
    """One event with every volunteer who signed up."""

    event = db.query(ActivityDB).filter(ActivityDB.id == event_id).first()

    if not event:
        raise HTTPException(
            status_code=404,
            detail=f"Event '{event_id}' not found",
        )

    completed = _app().is_completed(event)

    ngo_name = db.query(NGODB.name).filter(NGODB.id == event.ngo_id).scalar()

    rows = (
        db.query(ActivitySignupDB, VolunteerDB.name, VolunteerDB.email)
        .outerjoin(VolunteerDB, ActivitySignupDB.volunteer_id == VolunteerDB.id)
        .filter(ActivitySignupDB.activity_id == event.id)
        .order_by(ActivitySignupDB.created_at.asc(), ActivitySignupDB.id.asc())
        .all()
    )

    volunteers = []
    for signup, name, email in rows:
        if signup.approved_at is not None:
            signup_status = "Approved"
        elif completed:
            signup_status = "Not selected"
        else:
            signup_status = "Waiting for approval"

        volunteers.append(AdminEventVolunteer(
            volunteer_id=signup.volunteer_id,
            name=name,
            email=email,
            signup_status=signup_status,
            attendance_status=signup.attendance_status,
            rating=signup.rating,
            feedback=signup.feedback,
            created_at=signup.created_at,
        ))

    return AdminEventDetail(
        id=event.id,
        title=event.title,
        description=event.description,
        required_skills=event.required_skills,
        location=event.location,
        event_date=event.event_date,
        status_label=_event_status_label(event, completed),
        spots_available=event.spots_available,
        created_at=event.created_at,
        ngo_id=event.ngo_id,
        ngo_name=ngo_name,
        volunteers=volunteers,
    )


# ─── Conversation Viewer ──────────────────────────────────────────
@router.get(
    "/conversation",
    response_model=AdminConversation,
    dependencies=[Depends(require_admin)],
)
def get_admin_conversation(
    a: str = Query(..., min_length=1),
    b: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
):
    """The full thread between two emails, oldest first. Viewing is audit-logged."""

    a_email = a.strip().lower()
    b_email = b.strip().lower()

    if not a_email or not b_email:
        raise HTTPException(
            status_code=422,
            detail="Both email addresses are required",
        )

    sender = func.lower(MessageDB.sender_email)
    recipient = func.lower(MessageDB.recipient_email)

    messages = (
        db.query(MessageDB)
        .filter(or_(
            (sender == a_email) & (recipient == b_email),
            (sender == b_email) & (recipient == a_email),
        ))
        .order_by(MessageDB.created_at.asc(), MessageDB.id.asc())
        .all()
    )

    people = _lookup_people(db, [a_email, b_email])

    def participant(email: str) -> AdminParticipant:
        name, role = people.get(email, (email, "unknown"))
        return AdminParticipant(email=email, name=name, role=role)

    # Built before the audit commit, which expires the loaded rows.
    response = AdminConversation(
        a=participant(a_email),
        b=participant(b_email),
        messages=[
            AdminMessage(
                id=m.id,
                sender_email=m.sender_email,
                sender_role=m.sender_role,
                recipient_email=m.recipient_email,
                recipient_role=m.recipient_role,
                message_type=m.message_type,
                body=m.body,
                file_name=m.file_name,
                file_size=m.file_size,
                mime_type=m.mime_type,
                latitude=m.latitude,
                longitude=m.longitude,
                created_at=m.created_at,
                read_at=m.read_at,
            )
            for m in messages
        ],
    )

    log_admin_action(db, "view_conversation", "conversation", None, {
        "a": a_email,
        "b": b_email,
        "message_count": len(messages),
    })
    db.commit()

    return response


# ─── Audit Log ────────────────────────────────────────────────────
@router.get(
    "/actions",
    response_model=list[AdminActionEntry],
    dependencies=[Depends(require_admin)],
)
def list_admin_actions(
    limit: int = Query(default=50, ge=1),
    target_type: str = Query(default=""),
    target_id: str = Query(default=""),
    db: Session = Depends(get_db),
):
    """Admin actions, newest first."""

    query = db.query(AdminActionDB)

    if target_type.strip():
        query = query.filter(AdminActionDB.target_type == target_type.strip())

    if target_id.strip():
        query = query.filter(AdminActionDB.target_id == target_id.strip())

    rows = (
        query.order_by(AdminActionDB.id.desc())
        .limit(min(limit, ACTIONS_LIMIT_MAX))
        .all()
    )

    entries = []
    for row in rows:
        try:
            details = json.loads(row.details) if row.details else None
        except ValueError:
            details = row.details

        entries.append(AdminActionEntry(
            id=row.id,
            action=row.action,
            target_type=row.target_type,
            target_id=row.target_id,
            details=details,
            created_at=row.created_at,
        ))

    return entries
