import re
from datetime import datetime
from typing import Annotated, Any, Literal, Optional
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

try:
    from .event_rules import to_storage
except ImportError:
    from event_rules import to_storage


# Deliberately simple: one "@", no spaces, a dot in the domain.
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def normalise_email(value: str) -> str:
    """Trim + lowercase an email and check its basic shape (raises ValueError)."""
    value = (value or "").strip().lower()
    if len(value) > 254 or not EMAIL_PATTERN.match(value):
        raise ValueError("enter a valid email address")
    return value


def _required_text(value):
    if value is None:
        raise ValueError("must not be empty")
    value = value.strip()
    if not value:
        raise ValueError("must not be empty or whitespace only")
    return value


# ─── Pydantic Models ───────────────────────────────────────────────
# ─── Volunteer profile field rules ────────────────────────────────
# One definition, used by registration (Volunteer) and by Settings
# (VolunteerProfileUpdate), so the two can never drift apart.
VolunteerName = Annotated[str, Field(min_length=1, max_length=100)]
VolunteerText = Annotated[str, Field(min_length=1)]
VolunteerAge = Annotated[int, Field(ge=1, le=120)]


class Volunteer(BaseModel):
    name: VolunteerName
    email: str = Field(..., min_length=1)
    contact_number: VolunteerText
    password: str = Field(..., min_length=1)
    age: VolunteerAge
    designation: VolunteerText
    gender: VolunteerText

    # Existing matching fields.
    skills: VolunteerText
    location: VolunteerText
    availability: VolunteerText
    experience: Optional[str] = ""

    @field_validator("email")
    @classmethod
    def email_is_valid(cls, value: str) -> str:
        return normalise_email(value)


class NGO(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    category: Optional[str] = ""
    location: Optional[str] = ""
    motto: str = Field(..., min_length=1)
    legal_structure: str = Field(..., min_length=1)


class IssueCreate(BaseModel):
    """Public input for a report; AI and recommendation fields are server-owned."""

    reporter_name: Optional[str] = Field(default=None, max_length=100)
    contact_information: Optional[str] = Field(default=None, max_length=255)
    reporter_email: Optional[str] = Field(default=None, max_length=255)
    user_description: str = Field(..., min_length=1, max_length=5000)
    location: str = Field(..., min_length=1, max_length=500)
    image_paths: Optional[list[str]] = Field(default=None, max_length=10)

    @field_validator("user_description", "location")
    @classmethod
    def required_text_cannot_be_blank(cls, value: str) -> str:
        value = value.strip()

        if not value:
            raise ValueError("must not be empty or whitespace only")

        return value

    @field_validator("reporter_name", "contact_information")
    @classmethod
    def optional_text_is_trimmed(
        cls,
        value: Optional[str],
    ) -> Optional[str]:
        if value is None:
            return None

        value = value.strip()

        return value or None

    @field_validator("image_paths")
    @classmethod
    def image_paths_are_valid(
        cls,
        value: Optional[list[str]],
    ) -> Optional[list[str]]:
        if value is None:
            return None

        cleaned_paths = [path.strip() for path in value]

        if any(not path for path in cleaned_paths):
            raise ValueError("image paths must not be empty")

        if any(len(path) > 1000 for path in cleaned_paths):
            raise ValueError("image paths must be 1000 characters or fewer")

        return cleaned_paths


class IssueStatusUpdate(BaseModel):
    status: Literal[
        "Reported",
        "Under evaluation",
        "Accepted",
        "In Progress",
        "Resolved",
        "Rejected",
    ]


class IssueResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    complaint_id: str
    reporter_name: Optional[str]
    contact_information: Optional[str]
    reporter_email: Optional[str] = None
    user_description: str
    location: str
    image_paths: Optional[list[str]]
    ai_image_caption: Optional[str]
    ai_scene_category: Optional[str]
    merged_problem_description: Optional[str]
    status: str
    recommended_ngos: Optional[list[Any]]
    recommendation_explanations: Optional[list[Any]]
    created_at: datetime
    updated_at: datetime


class IssueStatsResponse(BaseModel):
    total_issues: int
    reported: int
    accepted: int
    in_progress: int
    resolved: int
    rejected: int


class IssueDeleteResponse(BaseModel):
    message: str
    complaint_id: str


class VolunteerDashboardResponse(BaseModel):
    name: str
    email: str
    contact_number: str
    age: int
    designation: str
    gender: str
    skills: Optional[str]
    location: Optional[str]
    availability: Optional[str]
    experience: Optional[str]


class NGODashboardResponse(BaseModel):
    name: str
    email: Optional[str]
    contact_number: Optional[str]
    category: Optional[str]
    location: Optional[str]
    year_founded: Optional[int]
    website_url: Optional[str]
    motto: Optional[str]
    legal_structure: Optional[str]
    verification_status: str
    verification_notes: Optional[str]
    work_images: Optional[list[str]]


class EventCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(default="", max_length=5000)
    required_skills: str = Field(..., min_length=1, max_length=1000)
    location: Optional[str] = Field(default="", max_length=300)
    # A day: "YYYY-MM-DD" or the browser's "YYYY-MM-DDT00:00:00.000Z".
    event_date: Optional[datetime] = None
    spots_available: Optional[int] = Field(default=None, ge=1, le=10000)

    @field_validator("title", "required_skills")
    @classmethod
    def required_text_not_blank(cls, value):
        return _required_text(value)

    @field_validator("event_date")
    @classmethod
    def date_only(cls, value):
        return to_storage(value)


class EventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ngo_id: int
    title: str
    description: Optional[str]
    required_skills: str
    location: Optional[str]
    event_date: Optional[datetime]
    spots_available: Optional[int]
    created_at: datetime
    status: str
    joined_count: int = 0
    approved_count: int = 0
    is_completed: bool = False
    feedback_count: int = 0
    # Server-computed, IST: "open" | "in_progress" | "completed".
    phase: str = "open"
    # The event day as "YYYY-MM-DD" (format it without any timezone shift).
    event_day: Optional[str] = None


class EventStatusUpdate(BaseModel):
    status: Literal["Active", "Cancelled", "Filled"]


class EventUpdate(BaseModel):
    """Partial update: only the fields sent are changed.

    title and required_skills may be left out but never sent as null or blank.
    """

    title: Optional[str] = Field(default=None, max_length=200)
    description: Optional[str] = Field(default=None, max_length=5000)
    required_skills: Optional[str] = Field(default=None, max_length=1000)
    location: Optional[str] = Field(default=None, max_length=300)
    event_date: Optional[datetime] = None
    spots_available: Optional[int] = Field(default=None, ge=1, le=10000)

    @field_validator("title", "required_skills")
    @classmethod
    def required_text_not_blank(cls, value):
        return _required_text(value)

    @field_validator("event_date")
    @classmethod
    def date_only(cls, value):
        return to_storage(value)


class NGOEventsResponse(BaseModel):
    ngo_name: str
    total_events: int
    events: list[EventResponse]


class EventVolunteerEntry(BaseModel):
    volunteer_id: int
    name: str
    email: str
    skills: Optional[str]
    experience: Optional[str]
    location: Optional[str]
    events_attended: int
    joined_at: datetime
    approved: bool
    approved_at: Optional[datetime] = None
    attendance_status: Optional[str] = None
    rating: Optional[int] = None
    feedback: Optional[str] = None


class EventVolunteersResponse(BaseModel):
    event_id: int
    title: str
    status: str
    spots_available: Optional[int]
    joined_count: int
    approved_count: int
    volunteers: list[EventVolunteerEntry]
    is_completed: bool = False
    phase: str = "open"
    event_date: Optional[datetime] = None
    event_day: Optional[str] = None


class ApprovalResponse(BaseModel):
    volunteer_id: int
    approved: bool
    approved_count: int


class FeedbackRequest(BaseModel):
    attendance: Literal["attended", "not_attended"]
    rating: Optional[int] = None
    feedback: Optional[str] = None


class FeedbackResponse(BaseModel):
    volunteer_id: int
    attendance_status: str
    rating: Optional[int]
    feedback: Optional[str]
    feedback_count: int


class NGOIssueEntry(BaseModel):
    complaint_id: str
    location: str
    user_description: str
    status: str
    created_at: datetime
    match_percentage: float
    confidence: str
    explanation: Optional[str] = None
    reporter_name: Optional[str] = None
    reporter_phone: Optional[str] = None
    reporter_email: Optional[str] = None
    ai_image_caption: Optional[str] = None
    ai_scene_category: Optional[str] = None
    resolution_status: Optional[str] = None
    reject_reason: Optional[str] = None
    solved: bool = False
    solved_by_me: bool = False
    solved_at: Optional[datetime] = None
    solution_type: Optional[str] = None
    solution_text: Optional[str] = None
    document_name: Optional[str] = None
    resolution_id: Optional[int] = None
    image_count: int = 0


class NGOIssuesResponse(BaseModel):
    ngo_name: str
    issues: list[NGOIssueEntry]


# ─── Issue Resolution Schemas ──────────────────────────────────────

class ResolutionResponse(BaseModel):
    resolution_id: int
    complaint_id: str
    status: str
    submitted_at: datetime


class VolunteerIssueEntry(BaseModel):
    complaint_id: str
    location: str
    user_description: str
    status: str
    created_at: datetime
    updated_at: datetime
    image_count: int
    ngo_count: int
    editable: bool
    solved: bool
    solved_by_ngo: Optional[str] = None
    solved_at: Optional[datetime] = None


class AdminResolutionEntry(BaseModel):
    resolution_id: int
    complaint_id: str
    ngo_id: int
    ngo_name: str
    location: Optional[str]
    description: Optional[str]
    solution_type: str
    solution_text: Optional[str]
    document_name: Optional[str]
    status: str
    submitted_at: datetime
    image_count: int = 0


# ─── Admin Console ────────────────────────────────────────────────
class AdminLoginRequest(BaseModel):
    password: str = Field(..., min_length=1, max_length=256)


class AdminLoginResponse(BaseModel):
    token: str
    expires_at: str


class AdminMeResponse(BaseModel):
    ok: bool
    expires_at: str


class AdminResolutionNGO(BaseModel):
    id: int
    name: str
    email: Optional[str]
    location: Optional[str]
    verification_status: str


class AdminResolutionIssue(BaseModel):
    complaint_id: str
    reporter_name: Optional[str]
    reporter_email: Optional[str]
    location: str
    user_description: str
    status: str
    created_at: datetime
    image_count: int


class AdminOtherResolution(BaseModel):
    id: int
    ngo_name: Optional[str]
    status: str
    submitted_at: datetime


class AdminResolutionDetail(BaseModel):
    id: int
    complaint_id: str
    ngo_id: int
    solution_type: str
    solution_text: Optional[str]
    document_name: Optional[str]
    status: str
    reject_reason: Optional[str]
    submitted_at: datetime
    decided_at: Optional[datetime]
    ngo: Optional[AdminResolutionNGO]
    issue: Optional[AdminResolutionIssue]
    other_resolutions: list[AdminOtherResolution]


# ─── Admin Console: Overview ──────────────────────────────────────
class AdminNGOCounts(BaseModel):
    total: int
    by_status: dict[str, int]


class AdminEventCounts(BaseModel):
    upcoming: int
    completed: int
    cancelled: int


class AdminSignupCounts(BaseModel):
    total: int
    approved: int
    attended: int


class AdminIssueCounts(BaseModel):
    total: int
    reported: int
    under_evaluation: int
    resolved: int
    other: int


class AdminActivityItem(BaseModel):
    type: str
    text: str
    at: datetime
    ref_type: str
    ref_id: str


class AdminOverview(BaseModel):
    ngos: AdminNGOCounts
    volunteers_total: int
    events: AdminEventCounts
    signups: AdminSignupCounts
    issues: AdminIssueCounts
    proofs_pending: int
    messages_total: int
    recent_activity: list[AdminActivityItem]


# ─── Admin Console: NGOs ──────────────────────────────────────────
class AdminNGOListItem(BaseModel):
    id: int
    name: str
    email: Optional[str]
    category: Optional[str]
    location: Optional[str]
    verification_status: str
    events_total: int
    events_upcoming: int
    events_completed: int
    events_cancelled: int
    problems_solved: int
    proofs_pending: int
    deactivated_at: Optional[datetime] = None


class AdminNGOProfile(BaseModel):
    name: str
    email: Optional[str]
    contact_number: Optional[str]
    category: Optional[str]
    location: Optional[str]
    motto: Optional[str]
    legal_structure: Optional[str]
    year_founded: Optional[int]
    website_url: Optional[str]
    verification_status: str
    verification_notes: Optional[str]
    verified_at: Optional[datetime]
    address: Optional[str] = None
    deactivated_at: Optional[datetime] = None


class AdminNGODocument(BaseModel):
    key: str
    label: str
    available: bool


class AdminNGOStats(BaseModel):
    events_total: int
    events_upcoming: int
    events_completed: int
    events_cancelled: int
    problems_solved: int
    proofs_pending: int
    volunteers_engaged: int
    average_rating_given: Optional[float]


class AdminNGOEvent(BaseModel):
    id: int
    title: str
    event_date: Optional[datetime]
    status_label: str
    spots_available: Optional[int]
    signups: int
    approved: int
    attended: int
    average_rating: Optional[float]


class AdminMatchedIssue(BaseModel):
    complaint_id: str
    location: str
    status: str
    created_at: datetime


class AdminNGOProof(BaseModel):
    id: int
    complaint_id: str
    status: str
    solution_type: str
    submitted_at: datetime
    decided_at: Optional[datetime]


class AdminNGOProblems(BaseModel):
    matched_open: list[AdminMatchedIssue]
    proofs: list[AdminNGOProof]


class AdminConversationSummary(BaseModel):
    email: str
    name: str
    role: str
    message_count: int
    last_message_at: datetime


class AdminNGODetail(BaseModel):
    id: int
    profile: AdminNGOProfile
    documents: list[AdminNGODocument]
    stats: AdminNGOStats
    events: list[AdminNGOEvent]
    problems: AdminNGOProblems
    conversations: list[AdminConversationSummary]


# ─── Admin Console: NGO Verification ──────────────────────────────
class AdminNGOApproveRequest(BaseModel):
    notes: Optional[str] = None

    @field_validator("notes")
    @classmethod
    def notes_length(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        if len(value) > 1000:
            raise ValueError("notes must be 1000 characters or fewer")
        return value or None


class AdminNGORejectRequest(BaseModel):
    reason: str

    @field_validator("reason")
    @classmethod
    def reason_length(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("reason must be at least 3 characters")
        if len(value) > 1000:
            raise ValueError("reason must be 1000 characters or fewer")
        return value


class AdminNGODecisionResponse(BaseModel):
    id: int
    name: str
    verification_status: str
    verification_notes: Optional[str]
    verified_at: Optional[datetime]


# ─── Admin Console: Volunteers ────────────────────────────────────
class AdminVolunteerListItem(BaseModel):
    id: int
    name: str
    email: str
    location: Optional[str]
    signups_total: int
    signups_approved: int
    events_attended: int
    issues_reported: int
    deactivated_at: Optional[datetime] = None


class AdminVolunteerProfile(BaseModel):
    # Every volunteers column except id (top level) and password.
    name: str
    email: str
    contact_number: Optional[str]
    age: Optional[int]
    designation: Optional[str]
    gender: Optional[str]
    skills: Optional[str]
    location: Optional[str]
    availability: Optional[str]
    experience: Optional[str]
    bio: Optional[str] = None
    cause_interests: Optional[str] = None
    deactivated_at: Optional[datetime] = None


class AdminVolunteerStats(BaseModel):
    signups_total: int
    signups_approved: int
    events_attended: int
    events_not_attended: int
    average_rating_received: Optional[float]
    issues_reported: int
    issues_resolved: int


class AdminVolunteerActivity(BaseModel):
    event_id: int
    event_title: Optional[str]
    ngo_id: Optional[int]
    ngo_name: Optional[str]
    event_date: Optional[datetime]
    event_status_label: Optional[str]
    signup_status: str
    attendance_status: Optional[str]
    rating: Optional[int]
    feedback: Optional[str]
    signed_up_at: datetime


class AdminVolunteerProblem(BaseModel):
    complaint_id: str
    location: str
    status: str
    created_at: datetime
    solved_by: Optional[str]


class AdminVolunteerDetail(BaseModel):
    id: int
    profile: AdminVolunteerProfile
    stats: AdminVolunteerStats
    activity: list[AdminVolunteerActivity]
    problems: list[AdminVolunteerProblem]
    conversations: list[AdminConversationSummary]


# ─── Admin Console: Events ────────────────────────────────────────
class AdminEventVolunteer(BaseModel):
    volunteer_id: int
    name: Optional[str]
    email: Optional[str]
    signup_status: str
    attendance_status: Optional[str]
    rating: Optional[int]
    feedback: Optional[str]
    created_at: datetime


class AdminEventDetail(BaseModel):
    id: int
    title: str
    description: Optional[str]
    required_skills: str
    location: Optional[str]
    event_date: Optional[datetime]
    status_label: str
    spots_available: Optional[int]
    created_at: datetime
    ngo_id: int
    ngo_name: Optional[str]
    volunteers: list[AdminEventVolunteer]


# ─── Admin Console: Conversations ─────────────────────────────────
class AdminParticipant(BaseModel):
    email: str
    name: str
    role: str


class AdminMessage(BaseModel):
    id: int
    sender_email: str
    sender_role: str
    recipient_email: str
    recipient_role: str
    message_type: str
    body: Optional[str]
    file_name: Optional[str]
    file_size: Optional[int]
    mime_type: Optional[str]
    latitude: Optional[float]
    longitude: Optional[float]
    created_at: datetime
    read_at: Optional[datetime]


class AdminConversation(BaseModel):
    a: AdminParticipant
    b: AdminParticipant
    messages: list[AdminMessage]


# ─── Admin Console: Audit Log ─────────────────────────────────────
class AdminActionEntry(BaseModel):
    id: int
    action: str
    target_type: Optional[str]
    target_id: Optional[str]
    details: Any
    created_at: datetime


class RejectRequest(BaseModel):
    reason: str

    @field_validator("reason")
    @classmethod
    def reason_length(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("reason must not be empty or whitespace only")
        if len(value) > 1000:
            raise ValueError("reason must be 1000 characters or fewer")
        return value


class MatchExplanation(BaseModel):
    """How a match score was built; every part is in score units (0 to 1)."""

    semantic: float
    category_boost: float = 0.0
    location_boost: float = 0.0
    skill_overlap: float = 0.0
    rating_bonus: float = 0.0
    matched_keywords: list[str] = []
    same_city: Optional[str] = None
    rated_events: int = 0
    average_rating: Optional[float] = None
    scoring: str = "v1"
    summary: str = ""


class VolunteerMatchEntry(BaseModel):
    ngo_name: str
    ngo_category: Optional[str]
    ngo_location: Optional[str]
    event_title: Optional[str]
    match_percentage: Optional[float]
    level: Optional[str] = None
    explanation: Optional["MatchExplanation"] = None


class VolunteerMatchesResponse(BaseModel):
    volunteer_name: str
    matches: list[VolunteerMatchEntry]


# ─── Volunteer ↔ Event Matching Schemas ────────────────────────────

class VolunteerEventEntry(BaseModel):
    activity_id: int
    title: str
    description: Optional[str]
    location: Optional[str]
    event_date: Optional[datetime]
    required_skills: str
    ngo_name: str
    ngo_category: Optional[str]
    ngo_location: Optional[str]
    ngo_email: Optional[str]
    match_percentage: float
    joined: bool
    approved: bool = False
    phase: str = "open"
    event_day: Optional[str] = None
    explanation: Optional["MatchExplanation"] = None


class VolunteerActivityEntry(BaseModel):
    activity_id: int
    title: str
    ngo_name: str
    ngo_email: Optional[str]
    location: Optional[str]
    event_date: Optional[datetime]
    event_status: str
    joined_at: datetime
    approved: bool
    approved_at: Optional[datetime]
    attended: bool
    status_label: str
    attendance_status: Optional[str] = None
    rating: Optional[int] = None
    feedback: Optional[str] = None
    phase: str = "open"
    event_day: Optional[str] = None


class JoinRequest(BaseModel):
    volunteer_email: str = Field(..., min_length=1)


class JoinResponse(BaseModel):
    joined: bool
    activity_id: int


# ─── Messaging Schemas ─────────────────────────────────────────────

class MessageSend(BaseModel):
    sender_email: str = Field(..., min_length=1)
    recipient_email: str = Field(..., min_length=1)
    body: str = Field(..., min_length=1, max_length=2000)

    @field_validator("body")
    @classmethod
    def body_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("body must not be empty or whitespace only")
        return value

    @field_validator("sender_email", "recipient_email")
    @classmethod
    def email_trimmed(cls, value: str) -> str:
        return value.strip().lower()


class LocationMessageSend(BaseModel):
    sender_email: str = Field(..., min_length=1)
    recipient_email: str = Field(..., min_length=1)
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)

    @field_validator("sender_email", "recipient_email")
    @classmethod
    def email_trimmed(cls, value: str) -> str:
        return value.strip().lower()


class MessageResponse(BaseModel):
    id: int
    sender_email: str
    sender_role: str
    recipient_email: str
    recipient_role: str
    message_type: str
    body: Optional[str]
    file_path: Optional[str] = None
    file_name: Optional[str] = None
    file_size: Optional[int] = None
    mime_type: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    created_at: str          # ISO-8601 with trailing Z
    read_at: Optional[str]   # ISO-8601 with trailing Z or null
    is_mine: bool = False
    file_url: Optional[str] = None


class ConversationEntry(BaseModel):
    other_email: str
    other_name: str
    other_role: str
    last_message_preview: str
    last_message_time: str   # ISO-8601 with trailing Z
    last_message_from_me: bool
    unread_count: int


class MarkReadRequest(BaseModel):
    reader_email: str = Field(..., min_length=1)
    other_email: str = Field(..., min_length=1)

    @field_validator("reader_email", "other_email")
    @classmethod
    def email_trimmed(cls, value: str) -> str:
        return value.strip().lower()


class MarkReadResponse(BaseModel):
    updated: int


# ─── Admin: rating / attendance override ──────────────────────────
class FeedbackOverrideRequest(BaseModel):
    attendance: Literal["attended", "not_attended"]
    rating: Optional[int] = None
    feedback: Optional[str] = None
    reason: str

    @field_validator("reason")
    @classmethod
    def reason_length(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("reason must be at least 3 characters")
        if len(value) > 500:
            raise ValueError("reason must be 500 characters or fewer")
        return value


class FeedbackOverrideResponse(BaseModel):
    event_id: int
    volunteer_id: int
    attendance_status: str
    rating: Optional[int]
    feedback: Optional[str]
    previous: dict


# ─── Password reset ───────────────────────────────────────────────
class ForgotPasswordRequest(BaseModel):
    role: Literal["volunteer", "ngo"]
    # Not format-checked: a malformed address gets the same answer as any other.
    email: str = Field(default="", max_length=320)


class ResetTokenRequest(BaseModel):
    token: str = Field(default="", max_length=200)


class ResetPasswordRequest(BaseModel):
    token: str = Field(default="", max_length=200)
    new_password: str = Field(default="", max_length=256)


class VerifyEmailRequest(BaseModel):
    token: str = Field(default="", max_length=200)


class ResendVerificationRequest(BaseModel):
    role: Literal["volunteer", "ngo"]
    # Not format-checked: a malformed address gets the same answer as any other.
    email: str = Field(default="", max_length=320)


# ─── Contact form ─────────────────────────────────────────────────
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _single_line(value: str) -> str:
    """No line breaks or control characters (these end up in mail headers)."""
    value = _CONTROL_CHARS.sub("", value.replace("\r", " ").replace("\n", " "))
    return " ".join(value.split())


class ContactRequest(BaseModel):
    name: str = Field(..., max_length=200)
    email: str = Field(..., max_length=320)
    subject: Optional[str] = Field(default=None, max_length=300)
    message: str = Field(..., max_length=4000)
    role: Optional[Literal["volunteer", "ngo", "other"]] = None
    # Honeypot: hidden in the form, so only bots fill it.
    website: Optional[str] = Field(default=None, max_length=500)

    @field_validator("name")
    @classmethod
    def name_ok(cls, value: str) -> str:
        value = _single_line(value)
        if not 2 <= len(value) <= 100:
            raise ValueError("name must be 2 to 100 characters")
        return value

    @field_validator("email")
    @classmethod
    def email_ok(cls, value: str) -> str:
        return normalise_email(value)

    @field_validator("subject")
    @classmethod
    def subject_ok(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = _single_line(value)
        if len(value) > 150:
            raise ValueError("subject must be 150 characters or fewer")
        return value or None

    @field_validator("message")
    @classmethod
    def message_ok(cls, value: str) -> str:
        value = _CONTROL_CHARS.sub("", value.replace("\r\n", "\n")).strip()
        if not 10 <= len(value) <= 2000:
            raise ValueError("message must be 10 to 2000 characters")
        return value


# ─── Account settings (account_settings.py) ───────────────────────
# Causes a volunteer can follow and the categories an NGO can pick: the same
# five categories as the registration forms and matching_config.CATEGORY_KEYWORDS.
CAUSE_CATEGORIES = ("Education", "Health", "Environment", "Animal Welfare", "Social Services")
MAX_CAUSES = 5
BIO_MAX = 1000
WEBSITE_MAX = 300
ADDRESS_MAX = 300
NGO_TEXT_MAX = 1000

# Fields that registration requires: in an update they may be left out, but
# not sent as null or blank.
_VOLUNTEER_REQUIRED = (
    "name", "contact_number", "age", "designation", "gender",
    "skills", "location", "availability",
)


def _strip_if_text(value):
    return value.strip() if isinstance(value, str) else value


def _reject_null(model: BaseModel, required) -> None:
    missing = [name for name in required if name in model.model_fields_set and getattr(model, name) is None]
    if missing:
        raise ValueError(f"{', '.join(missing)} cannot be empty")


def normalise_skills(value: str) -> str:
    """"a,  b , ,A" -> "a, b": trimmed, no empty items, no repeats (any case)."""
    seen = set()
    items = []
    for part in (value or "").split(","):
        item = " ".join(part.split())
        if item and item.lower() not in seen:
            seen.add(item.lower())
            items.append(item)
    return ", ".join(items)


def normalise_website(value: Optional[str]) -> Optional[str]:
    """An http(s) address with a dotted host, or None for blank. Raises ValueError otherwise.

    A bare domain ("example.org") becomes https://example.org, like
    safeExternalUrl() in the frontend.
    """
    text = (value or "").strip()
    if not text:
        return None
    if len(text) > WEBSITE_MAX or re.search(r"[\s<>\"\\\\]", text) or text.startswith("/"):
        raise ValueError("enter a website address such as https://example.org")
    if not re.match(r"^[a-z][a-z0-9+.-]*:", text, re.IGNORECASE):
        text = f"https://{text}"
    try:
        parts = urlsplit(text)
        host = parts.hostname or ""
    except ValueError:
        raise ValueError("enter a website address such as https://example.org")
    if parts.scheme.lower() not in ("http", "https") or "." not in host or "@" in parts.netloc:
        raise ValueError("the website must start with http:// or https://")
    return text


class VolunteerProfileUpdate(BaseModel):
    """PATCH /volunteer/me. Only these fields can change; anything else is a 422."""

    model_config = ConfigDict(extra="forbid")

    name: Optional[VolunteerName] = None
    contact_number: Optional[VolunteerText] = None
    age: Optional[VolunteerAge] = None
    designation: Optional[VolunteerText] = None
    gender: Optional[VolunteerText] = None
    skills: Optional[VolunteerText] = None
    location: Optional[VolunteerText] = None
    availability: Optional[VolunteerText] = None
    experience: Optional[str] = Field(default=None, max_length=100)
    bio: Optional[str] = Field(default=None, max_length=BIO_MAX)
    cause_interests: Optional[list[str]] = Field(default=None, max_length=MAX_CAUSES)

    # Trimmed before the length rules run, so "   " fails min_length=1.
    @field_validator(
        "name", "contact_number", "designation", "gender", "skills",
        "location", "availability", "experience", "bio", mode="before",
    )
    @classmethod
    def trim(cls, value):
        return _strip_if_text(value)

    @field_validator("skills")
    @classmethod
    def skills_list(cls, value):
        if value is None:
            return value
        value = normalise_skills(value)
        if not value:
            raise ValueError("add at least one skill")
        return value

    @field_validator("cause_interests")
    @classmethod
    def known_causes(cls, value):
        if value is None:
            return value
        cleaned = []
        for item in value:
            item = (item or "").strip()
            if item not in CAUSE_CATEGORIES:
                raise ValueError(f"choose causes from: {', '.join(CAUSE_CATEGORIES)}")
            if item not in cleaned:
                cleaned.append(item)
        return cleaned

    @model_validator(mode="after")
    def required_not_null(self):
        _reject_null(self, _VOLUNTEER_REQUIRED)
        return self


class VolunteerProfileResponse(BaseModel):
    name: str
    email: str
    contact_number: Optional[str]
    age: Optional[int]
    designation: Optional[str]
    gender: Optional[str]
    skills: Optional[str]
    location: Optional[str]
    availability: Optional[str]
    experience: Optional[str]
    bio: Optional[str]
    cause_interests: list[str]


class NGOProfileUpdate(BaseModel):
    """PATCH /ngo/me. Name, email, documents and approval status are not here (422)."""

    model_config = ConfigDict(extra="forbid")

    motto: Optional[str] = Field(default=None, min_length=1, max_length=NGO_TEXT_MAX)
    location: Optional[str] = Field(default=None, min_length=1, max_length=200)
    address: Optional[str] = Field(default=None, max_length=ADDRESS_MAX)
    contact_number: Optional[str] = Field(default=None, min_length=1, max_length=40)
    website_url: Optional[str] = Field(default=None, max_length=WEBSITE_MAX)
    category: Optional[str] = None

    @field_validator("motto", "location", "address", "contact_number", "website_url", "category", mode="before")
    @classmethod
    def trim(cls, value):
        return _strip_if_text(value)

    @field_validator("website_url")
    @classmethod
    def website(cls, value):
        return normalise_website(value)

    @field_validator("category")
    @classmethod
    def known_category(cls, value):
        if value is not None and value not in CAUSE_CATEGORIES:
            raise ValueError(f"choose a category from: {', '.join(CAUSE_CATEGORIES)}")
        return value

    @model_validator(mode="after")
    def required_not_null(self):
        _reject_null(self, ("motto", "location", "contact_number", "category"))
        return self


class NGODocumentOnFile(BaseModel):
    kind: str
    label: str


class NGOProfileResponse(BaseModel):
    name: str
    email: Optional[str]
    contact_number: Optional[str]
    category: Optional[str]
    location: Optional[str]
    address: Optional[str]
    website_url: Optional[str]
    motto: Optional[str]
    legal_structure: Optional[str]
    year_founded: Optional[int]
    verification_status: str
    documents: list[NGODocumentOnFile]


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(default="", max_length=200)
    new_password: str = Field(default="", max_length=200)


class SessionEntry(BaseModel):
    id: int
    device: Optional[str]
    created_at: str
    last_used_at: Optional[str]
    expires_at: str
    current: bool


class ChangeEmailRequest(BaseModel):
    password: str = Field(default="", max_length=200)
    new_email: str = Field(..., min_length=1, max_length=254)

    @field_validator("new_email")
    @classmethod
    def email_is_valid(cls, value: str) -> str:
        return normalise_email(value)


class EmailChangeTokenRequest(BaseModel):
    token: str = Field(default="", max_length=200)


class PasswordConfirmRequest(BaseModel):
    password: str = Field(default="", max_length=200)


class DeactivateRequest(BaseModel):
    password: str = Field(default="", max_length=200)
    confirm: str = Field(default="", max_length=50)
