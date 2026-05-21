from datetime import datetime
from pydantic import BaseModel, ConfigDict


class MemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    email: str | None = None
    location: str | None = None
    tshirt_size: str | None = None
    position: int = 0


class TeamOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    external_id: str | None = None
    name: str
    mentor_name: str | None = None
    mentor_email: str | None = None
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
    edit_reason: str | None = None


class MemberPatch(BaseModel):
    name: str | None = None
    email: str | None = None
    location: str | None = None
    tshirt_size: str | None = None
    edit_reason: str | None = None


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
