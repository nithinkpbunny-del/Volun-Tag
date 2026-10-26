"""Admin console routes: login, session check, and proof review details."""

from fastapi import APIRouter, Depends, HTTPException
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
    from .db_models import AdminSessionDB, IssueResolutionDB, NGODB
    from .issue_service import get_issue_by_complaint_id
    from .schemas import (
        AdminLoginRequest, AdminLoginResponse, AdminMeResponse,
        AdminOtherResolution, AdminResolutionDetail, AdminResolutionIssue,
        AdminResolutionNGO,
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
    from db_models import AdminSessionDB, IssueResolutionDB, NGODB
    from issue_service import get_issue_by_complaint_id
    from schemas import (
        AdminLoginRequest, AdminLoginResponse, AdminMeResponse,
        AdminOtherResolution, AdminResolutionDetail, AdminResolutionIssue,
        AdminResolutionNGO,
    )


router = APIRouter(prefix="/admin", tags=["admin"])


def _fmt_utc(dt) -> str:
    """Format a naive UTC datetime as ISO-8601 with a trailing Z."""
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


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
