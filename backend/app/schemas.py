from datetime import datetime
from pydantic import BaseModel, ConfigDict


class MemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    email: str | None = None
    location: str | None = None
    tshirt_size: str | None = None
    address: str | None = None
    position: int = 0


class TeamOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    external_id: str | None = None
    name: str
    mentor_name: str | None = None
    mentor_email: str | None = None
    mentor_location: str | None = None
    mentor_tshirt_size: str | None = None
    mentor_address: str | None = None
    idea: str | None = None
    tools: str | None = None
    approach: str | None = None
    viability: str | None = None
    business_value: str | None = None
    submitted_at: datetime | None = None
    completeness_score: float = 0.0
    flags: list[str] = []
    members: list[MemberOut] = []
    ai_scores: dict | None = None
    judge_scores: dict | None = None
    repo_url: str | None = None
    has_teams_channel: bool = False
    teams_channel_id: str | None = None
    teams_channel_created_at: datetime | None = None
    presentation_uploaded: bool = False
    repo_ready: bool = False
    repo_check_notes: str | None = None
    advanced_to_round: int = 1
    final_position: int | None = None
    seat_floor: str | None = None
    seat_desk: str | None = None
    seat_landmark: str | None = None
    seat_updated_at: datetime | None = None
    seat_updated_by: str | None = None


class JudgeAIRequest(BaseModel):
    repo_url: str | None = None


class JudgeHumanRequest(BaseModel):
    scores: dict
    panelist: str | None = None
    repo_url: str | None = None


# ---- New M4: live judge panel scoring ----

JUDGE_RUBRIC_AXES = (
    ("problem_clarity",    "Problem clarity"),
    ("solution_viability", "Solution viability"),
    ("industry_readiness", "Industry readiness"),
    ("roi",                "ROI / Business value"),
    ("novelty",            "Novelty"),
)
JUDGE_RUBRIC_KEYS = tuple(k for k, _ in JUDGE_RUBRIC_AXES)


class JudgeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    email: str | None = None
    role: str = "judge"
    is_active: bool = True


class JudgeCreate(BaseModel):
    name: str
    email: str | None = None
    role: str = "judge"


class JudgeUpdate(BaseModel):
    """All fields optional — PATCH semantics. Only supplied fields are updated."""
    name: str | None = None
    email: str | None = None
    role: str | None = None


class JudgeBulkRow(BaseModel):
    name: str
    email: str
    role: str = "judge"


class JudgeBulkRequest(BaseModel):
    """Bulk-add judges. Each row is upserted by email (case-insensitive) so
    re-runs are safe — already-present judges count as 'skipped', not error."""
    rows: list[JudgeBulkRow]


class JudgeBulkResult(BaseModel):
    created_count: int
    updated_count: int
    skipped_count: int
    failed: list[dict]  # [{name, email, error}]


class TeamSeatRequest(BaseModel):
    """Self-service floor-walk seat update from the public /team/<id> page.
    Floor is constrained to the three RealPage India office floors; desk and
    landmark are free-form so teams can describe their spot in their own
    words ('Near coffee machine', 'A-12 by window', etc.). submitted_by
    captures who in the team / mentor circle made the update so organizers
    can chase the right person if the info turns out to be wrong."""
    floor: str  # '5th' | '9th' | '10th' — server validates
    desk: str
    landmark: str | None = None
    submitted_by: str | None = None


class UserRoleOut(BaseModel):
    """Result of looking up the signed-in user's role in the Judge table."""
    role: str  # "organizer" | "judge" | "none"
    judge_id: int | None = None
    name: str | None = None
    email: str | None = None


class JudgeAssignmentSet(BaseModel):
    """Bulk-set the team assignments for a specific judge in a specific round."""
    round: int
    team_ids: list[int]


class JudgeAssignmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    judge_id: int
    team_id: int
    round: int


class PanelOut(BaseModel):
    """A panel with its team_ids and judge_ids flattened for the frontend."""
    id: int
    name: str
    round: int
    team_ids: list[int] = []
    judge_ids: list[int] = []


class PanelCreate(BaseModel):
    name: str
    round: int


class PanelUpdate(BaseModel):
    name: str | None = None


class PanelTeamsSet(BaseModel):
    team_ids: list[int]


class PanelJudgesSet(BaseModel):
    judge_ids: list[int]


class PanelSwapTeamDays(BaseModel):
    team_a_id: int
    team_b_id: int


class AdoptChannelByLinkRequest(BaseModel):
    """Paste a Teams 'Get link to channel' URL or a raw channel id."""
    teams_channel_link: str


# ===== Swag (t-shirt) pickup =====

class SwagPersonOut(BaseModel):
    """One person on the swag-pickup list."""
    email: str
    name: str
    tshirt_size: str | None = None
    country: str | None = None  # 'India', 'US', 'Philippines', etc. — used for filtering pickup vs shipment lists
    roles: list[str] = []  # e.g. ['member:AgenTicket', 'mentor:DeepThinkers']
    teams: list[str] = []  # team names the person is associated with
    # Category badge shown in the SwagPanel UI: 'Member', 'Mentor', 'Judge',
    # 'Organiser', 'Support', 'Leadership', 'HR', etc. Computed server-side
    # from the roster source (member/mentor roster vs. extras table) so the
    # UI doesn't have to parse role strings.
    category: str = "Member"
    collected: bool = False
    collected_at: str | None = None  # ISO timestamp when collected
    collected_by_email: str | None = None  # organizer who marked it
    picked_up_by_name: str | None = None   # person who physically picked up (null = self)
    picked_up_by_email: str | None = None
    notes: str | None = None


class SwagExtraOut(BaseModel):
    """One non-team person in the swag-extras roster (judge / organiser /
    support / leadership / HR). Returned by GET /api/swag/extras."""
    id: int
    email: str
    name: str
    tshirt_size: str | None = None
    country: str | None = None
    category: str
    created_at: str | None = None


class SwagExtraImportResult(BaseModel):
    created_count: int
    updated_count: int
    skipped_existing_roster_count: int  # email already on member/mentor list
    failed: list[dict]                    # [{name, email, error}]
    by_category: dict[str, int]           # 'Judge': 23, 'Support': 11, ...


class JudgeVisitMarkRequest(BaseModel):
    team_id: int
    judge_id: int
    notes: str | None = None


class VisitNotesUpdate(BaseModel):
    """PATCH /api/visits/{id} body. Empty string clears the field; None
    leaves the existing value alone (FastAPI default model behaviour)."""
    notes: str | None = None


class JudgeVisitOut(BaseModel):
    """One judge -> team visit record, with the judge's name denormalized
    so the frontend doesn't need a second join lookup."""
    id: int
    team_id: int
    judge_id: int
    judge_name: str | None = None
    visited_at: str  # ISO timestamp
    marked_by_email: str | None = None
    notes: str | None = None


class JudgeVisitsByTeam(BaseModel):
    """Map of team_id -> list of judges who visited that team. Drives the
    main Floor walk view: per-team rows show a visit count + an expandable
    toggle list of all judges."""
    by_team: dict[int, list[JudgeVisitOut]]


class JudgeVisitsStats(BaseModel):
    total_teams: int
    teams_with_any_visit: int
    teams_with_zero_visits: int
    total_visits: int
    per_team_counts: dict[int, int]   # team_id -> visitor count
    per_judge_counts: dict[int, int]  # judge_id -> teams-visited count


class SwagMarkRequest(BaseModel):
    email: str
    notes: str | None = None
    # Optional collect-on-behalf-of fields. If both empty, treat as
    # the person picking up for themselves.
    picked_up_by_name: str | None = None
    picked_up_by_email: str | None = None


class SwagStats(BaseModel):
    total: int
    collected: int
    pending: int


class JudgeScoreSubmit(BaseModel):
    judge_id: int
    team_id: int
    round: int
    scores: dict[str, int]  # {axis_key: 0..10}
    comment: str | None = None
    entered_by_email: str | None = None  # set when organizer enters on behalf


class JudgeScoreOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    judge_id: int
    team_id: int
    round: int
    scores: dict[str, int]
    comment: str | None = None
    total: int
    entered_by_email: str | None = None
    submitted_at: datetime


class LeaderboardRow(BaseModel):
    team_id: int
    team_name: str
    judge_count: int
    total_sum: int
    avg_score: float
    per_axis_avg: dict[str, float]
    comments: list[dict]  # [{judge_name, comment}]


class LeaderboardOut(BaseModel):
    round: int
    rows: list[LeaderboardRow]


# ===== Comms / audit =====

class CommLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    team_id: int | None = None
    kind: str
    template_id: str | None = None
    subject: str | None = None
    body: str | None = None
    recipients: list[str] = []
    status: str = "sent"
    sent_by_email: str | None = None
    sent_at: datetime


class TeamChannelCreateRequest(BaseModel):
    team_ids: list[int] | None = None
    sent_by_email: str | None = None


class TeamMessageRequest(BaseModel):
    message: str
    sent_by_email: str | None = None


class BroadcastRequest(BaseModel):
    message: str
    team_ids: list[int] | None = None  # null = all
    sent_by_email: str | None = None


class CommLogCreateRequest(BaseModel):
    team_id: int | None = None
    kind: str
    template_id: str | None = None
    subject: str | None = None
    body: str | None = None
    recipients: list[str] = []
    sent_by_email: str | None = None
    status: str = "sent"


class RepoCheckOut(BaseModel):
    ready: bool
    notes: str
    github: dict | None = None


class ReadinessFlagsRequest(BaseModel):
    presentation_uploaded: bool | None = None
    repo_url: str | None = None
    has_teams_channel: bool | None = None


class UploadResult(BaseModel):
    teams_imported: int
    teams_skipped: int
    duplicate_participants: int
    multi_team_mentors: int


class DashboardStats(BaseModel):
    total_teams: int
    complete_teams: int
    flagged_teams: int
    duplicate_participants: int
    multi_team_mentors: int
    locations: dict[str, int]
    tshirt_sizes: dict[str, int]
    # Unique people = set(mentor identities) ∪ set(member identities).
    # Identity is the lowercased email when present, else the lowercased
    # name as fallback. A person who is both a mentor and a team member
    # only counts once.
    total_unique_people: int = 0


class AIScreenResult(BaseModel):
    scored: int
    skipped: int
    failed: int
    providers: dict[str, int]


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]


class ChatResponse(BaseModel):
    reply: str
    team_refs: list[int] = []
    provider: str | None = None
    model: str | None = None
    error: str | None = None


# ---- Tournament progression (Round 1 -> 2 -> 3 -> Winners) ----

class RoundAdvanceRequest(BaseModel):
    """Move a specific set of team IDs forward to the next round.

    `from_round` is the round just completed (1, 2 or 3). The chosen
    team_ids will have their advanced_to_round bumped to from_round + 1.
    Teams not in the list are NOT touched — they're eliminated by
    omission, not by an explicit demotion.
    """
    from_round: int  # 1, 2, or 3
    team_ids: list[int]


class WinnersSetRequest(BaseModel):
    """Crown the 1st / 2nd / 3rd place teams after Round 3.

    Map keys are positions ('1', '2', '3'); values are team IDs. Any
    omitted positions are cleared. Pass an empty positions dict to
    unset all winners.
    """
    positions: dict[str, int]


class RoundSummary(BaseModel):
    round: int
    eligible_team_count: int  # how many teams are in this round
    scored_team_count: int    # how many of them have at least one judge score


class TeamCreate(BaseModel):
    """Payload for manually creating a new team via the dashboard.
    Bypasses the MS Forms import flow — used when an organizer needs to add
    a team that came in by email / Teams chat / late-registration."""
    name: str
    mentor_name: str | None = None
    mentor_email: str | None = None
    mentor_location: str | None = None
    mentor_tshirt_size: str | None = None
    mentor_address: str | None = None
    idea: str | None = None
    tools: str | None = None
    approach: str | None = None
    viability: str | None = None
    business_value: str | None = None
    repo_url: str | None = None
    members: list["MemberCreate"] = []  # forward ref; resolved below
    edit_reason: str | None = None


class TeamPatch(BaseModel):
    """Partial-update payload for a team. Every field is optional — only
    keys present in the request body are written. Audit log records the
    optional `edit_reason`. Computed fields (completeness_score, flags,
    ai_scores, advanced_to_round, final_position) are not editable here;
    they have their own dedicated flows.
    """
    name: str | None = None
    mentor_name: str | None = None
    mentor_email: str | None = None
    mentor_location: str | None = None
    mentor_tshirt_size: str | None = None
    mentor_address: str | None = None
    idea: str | None = None
    tools: str | None = None
    approach: str | None = None
    viability: str | None = None
    business_value: str | None = None
    repo_url: str | None = None
    edit_reason: str | None = None


class MemberCreate(BaseModel):
    name: str
    email: str | None = None
    location: str | None = None
    tshirt_size: str | None = None
    address: str | None = None
    edit_reason: str | None = None


class MemberPatch(BaseModel):
    name: str | None = None
    email: str | None = None
    location: str | None = None
    tshirt_size: str | None = None
    address: str | None = None
    edit_reason: str | None = None


# Resolve forward reference TeamCreate -> MemberCreate now that both are defined.
TeamCreate.model_rebuild()


class EmailTemplateOut(BaseModel):
    id: str
    label: str
    description: str
    audience: str
    subject: str


class EmailRenderRequest(BaseModel):
    template_id: str
    team_ids: list[int] | None = None


class RenderedEmail(BaseModel):
    team_id: int
    team_name: str
    audience: str
    to: list[str]
    subject: str
    body: str
    body_html: str | None = None
    missing_fields: list[str] = []
