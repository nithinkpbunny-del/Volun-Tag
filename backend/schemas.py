from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


# ─── Pydantic Models ───────────────────────────────────────────────
class Volunteer(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    email: str = Field(..., min_length=1)
    contact_number: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)
    age: int = Field(..., ge=1, le=120)
    designation: str = Field(..., min_length=1)
    gender: str = Field(..., min_length=1)

    # Existing matching fields.
    skills: str = Field(..., min_length=1)
    location: str = Field(..., min_length=1)
    availability: str = Field(..., min_length=1)
    experience: Optional[str] = ""


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
    description: Optional[str] = ""
    required_skills: str = Field(..., min_length=1)
    location: Optional[str] = ""
    event_date: Optional[datetime] = None
    spots_available: Optional[int] = None


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


class EventStatusUpdate(BaseModel):
    status: Literal["Active", "Cancelled", "Filled"]


class EventUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    required_skills: Optional[str] = None
    location: Optional[str] = None
    event_date: Optional[datetime] = None
    spots_available: Optional[int] = None


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
    ngo_name: str
    location: Optional[str]
    description: Optional[str]
    solution_type: str
    solution_text: Optional[str]
    document_name: Optional[str]
    status: str
    submitted_at: datetime


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


class VolunteerMatchEntry(BaseModel):
    ngo_name: str
    ngo_category: Optional[str]
    ngo_location: Optional[str]
    event_title: Optional[str]
    match_percentage: Optional[float]
    level: Optional[str] = None


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
