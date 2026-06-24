from datetime import datetime
from sqlalchemy import String, Integer, Text, ForeignKey, DateTime, JSON, UniqueConstraint, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class Team(Base):
    __tablename__ = "teams"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    external_id: Mapped[str | None] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    mentor_name: Mapped[str | None] = mapped_column(String(255))
    mentor_email: Mapped[str | None] = mapped_column(String(255))
    # Free-form so organizers can type in countries beyond the US/India/PH
    # short-list when editing a team via the dashboard ("Other" → free text).
    mentor_location: Mapped[str | None] = mapped_column(String(64))
    mentor_tshirt_size: Mapped[str | None] = mapped_column(String(16))
    # Mailing address for swag shipping (US/PH members only — India members
    # receive swag at the office). Captured by the MS Forms column
    # "Enter your mailing address if you opted for US or PH as location".
    mentor_address: Mapped[str | None] = mapped_column(Text)
    idea: Mapped[str | None] = mapped_column(Text)
    tools: Mapped[str | None] = mapped_column(Text)
    approach: Mapped[str | None] = mapped_column(Text)
    viability: Mapped[str | None] = mapped_column(Text)
    business_value: Mapped[str | None] = mapped_column(Text)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime)
    raw: Mapped[dict | None] = mapped_column(JSON)

    completeness_score: Mapped[float] = mapped_column(default=0.0)
    flags: Mapped[list | None] = mapped_column(JSON, default=list)
    ai_scores: Mapped[dict | None] = mapped_column(JSON, default=dict)
    judge_scores: Mapped[dict | None] = mapped_column(JSON, default=dict)
    repo_url: Mapped[str | None] = mapped_column(String(512))

    # Readiness / Teams channel state — populated via mock today, real Graph API after IT approval
    has_teams_channel: Mapped[bool] = mapped_column(Boolean, default=False)
    teams_channel_id: Mapped[str | None] = mapped_column(String(128))
    teams_channel_created_at: Mapped[datetime | None] = mapped_column(DateTime)
    presentation_uploaded: Mapped[bool] = mapped_column(Boolean, default=False)
    repo_ready: Mapped[bool] = mapped_column(Boolean, default=False)
    repo_check_notes: Mapped[str | None] = mapped_column(Text)

    # Tournament progression. advanced_to_round is the highest round this team
    # is eligible for — defaults to 1 (registered for Round 1). Set to 2 when
    # the organizer advances them past Round 1, 3 when past Round 2, 4 when
    # past Round 3 (i.e. in the winners pool). final_position is 1/2/3 for
    # the podium after Round 3, null otherwise.
    advanced_to_round: Mapped[int] = mapped_column(Integer, default=1)
    final_position: Mapped[int | None] = mapped_column(Integer, default=None)

    # Floor-walk seating, captured from each team via the public /team/<id>
    # page (no auth — anyone with the QR can update). Drives the dashboard
    # 'Floor-walk coverage' panel that organizers use to chase laggards
    # before judging starts. seat_updated_by is best-effort: filled from the
    # MSAL ID token if the submitter happened to be signed in, otherwise null.
    seat_floor: Mapped[str | None] = mapped_column(String(16))  # '5th' | '9th' | '10th'
    seat_desk: Mapped[str | None] = mapped_column(String(64))
    seat_landmark: Mapped[str | None] = mapped_column(Text)
    seat_updated_at: Mapped[datetime | None] = mapped_column(DateTime)
    seat_updated_by: Mapped[str | None] = mapped_column(String(255))

    # Demo presentation status, marked by organizers on the Floor walk tab
    # during judging. Values: 'pending' (default, before the team is called),
    # 'done' (team finished presenting), 'no_show' (team didn't show up).
    # Distinct from judge_visits -- judge visits track who came to the desk,
    # demo_status tracks whether the team actually presented at all.
    demo_status: Mapped[str] = mapped_column(String(16), default='pending')
    demo_status_at: Mapped[datetime | None] = mapped_column(DateTime)
    demo_status_by: Mapped[str | None] = mapped_column(String(255))

    members: Mapped[list["Member"]] = relationship(back_populates="team", cascade="all, delete-orphan")


class Member(Base):
    __tablename__ = "members"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # ON DELETE CASCADE: when a Team is deleted (e.g. a re-upload wipes
    # teams), its members go with it.
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    email: Mapped[str | None] = mapped_column(String(255), index=True)
    location: Mapped[str | None] = mapped_column(String(64))
    tshirt_size: Mapped[str | None] = mapped_column(String(16))
    # Mailing address for swag shipping (US/PH members only). Long-text so
    # it can hold multi-line postal addresses without truncation.
    address: Mapped[str | None] = mapped_column(Text)
    position: Mapped[int] = mapped_column(default=0)

    team: Mapped["Team"] = relationship(back_populates="members")


class Judge(Base):
    __tablename__ = "judges"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, index=True)
    ado_id: Mapped[str | None] = mapped_column(String(128), unique=True, index=True)
    role: Mapped[str] = mapped_column(String(32), default="judge")  # judge | organizer
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class JudgeAssignment(Base):
    """Legacy direct judge-to-team assignment, kept for backward compatibility.

    Superseded by the Panel model — Panels group teams + judges together so
    every judge in a panel sees every team in the panel. This table stays
    around to avoid breaking older rows but new flows should use Panel.
    """
    __tablename__ = "judge_assignments"
    __table_args__ = (
        UniqueConstraint("judge_id", "team_id", "round", name="uq_judge_team_round_assignment"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    judge_id: Mapped[int] = mapped_column(ForeignKey("judges.id", ondelete="CASCADE"), index=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"), index=True)
    round: Mapped[int] = mapped_column(Integer, index=True)  # 1 | 2 | 3
    assigned_by_email: Mapped[str | None] = mapped_column(String(255))
    assigned_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    judge: Mapped["Judge"] = relationship()
    team: Mapped["Team"] = relationship()


class Panel(Base):
    """A group of judges that collectively scores a group of teams in a given round.

    Round 1 typically splits 95 teams across 2 panels (~48 each); each panel
    has its own set of 3-4 judges. Teams CAN appear in multiple panels — useful
    for finals where you want broader judge coverage on advancing teams.
    """
    __tablename__ = "panels"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128))  # "Panel 1", "Panel 2", ...
    round: Mapped[int] = mapped_column(Integer, index=True)  # 1 | 2 | 3
    created_by_email: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    teams: Mapped[list["PanelTeam"]] = relationship(back_populates="panel", cascade="all, delete-orphan")
    judges: Mapped[list["PanelJudge"]] = relationship(back_populates="panel", cascade="all, delete-orphan")


class PanelTeam(Base):
    __tablename__ = "panel_teams"
    __table_args__ = (
        UniqueConstraint("panel_id", "team_id", name="uq_panel_team"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    panel_id: Mapped[int] = mapped_column(ForeignKey("panels.id", ondelete="CASCADE"), index=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"), index=True)

    panel: Mapped["Panel"] = relationship(back_populates="teams")
    team: Mapped["Team"] = relationship()


class PanelJudge(Base):
    __tablename__ = "panel_judges"
    __table_args__ = (
        UniqueConstraint("panel_id", "judge_id", name="uq_panel_judge"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    panel_id: Mapped[int] = mapped_column(ForeignKey("panels.id", ondelete="CASCADE"), index=True)
    judge_id: Mapped[int] = mapped_column(ForeignKey("judges.id", ondelete="CASCADE"), index=True)

    panel: Mapped["Panel"] = relationship(back_populates="judges")
    judge: Mapped["Judge"] = relationship()


class PanelTeamDayOverride(Base):
    """Pin a panel team to Day 1 or Day 2 of the judging schedule,
    overriding the auto-distribution algorithm.

    Used by the 'Move to Day N' UI in the invite workspace — once the
    organizer manually moves a team across days, that decision survives
    page refreshes and is honoured by subsequent invite-meta requests.

    No row -> auto-distribute (US-first, balanced across both days).
    """
    __tablename__ = "panel_team_day_overrides"
    __table_args__ = (
        UniqueConstraint("panel_id", "team_id", name="uq_panel_team_day_override"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    panel_id: Mapped[int] = mapped_column(ForeignKey("panels.id", ondelete="CASCADE"), index=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"), index=True)
    day: Mapped[int] = mapped_column(Integer)  # 1 or 2


class JudgeScore(Base):
    __tablename__ = "judge_score_records"
    __table_args__ = (
        UniqueConstraint("judge_id", "team_id", "round", name="uq_judge_team_round"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    judge_id: Mapped[int] = mapped_column(ForeignKey("judges.id", ondelete="CASCADE"), index=True)
    # ON DELETE CASCADE: re-uploading teams wipes their scores too. Scores
    # are always tied to a specific team; orphaned ones serve no purpose.
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"), index=True)
    round: Mapped[int] = mapped_column(Integer, index=True)  # 1 | 2 | 3
    scores: Mapped[dict] = mapped_column(JSON)  # {axis_key: int /10}
    comment: Mapped[str | None] = mapped_column(Text)
    total: Mapped[int] = mapped_column(Integer, default=0)  # sum across axes
    entered_by_email: Mapped[str | None] = mapped_column(String(255))  # null = self, else organizer email
    submitted_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    judge: Mapped["Judge"] = relationship()
    team: Mapped["Team"] = relationship()


class SwagPickup(Base):
    """T-shirt / swag pickup tracking for event day.

    One row per person (keyed by lowercased email) — same person showing up
    as a mentor on multiple teams still picks up exactly one t-shirt. The
    'people' list shown to organizers is computed at query time by joining
    the Member + Team-mentor rosters against this table.

    Updated by organizers at the pickup desk via the Swag tab.
    """
    __tablename__ = "swag_pickups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)  # lowercased
    person_name: Mapped[str] = mapped_column(String(255))
    tshirt_size: Mapped[str | None] = mapped_column(String(16))
    collected_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    # Organizer who clicked the 'Mark collected' button.
    collected_by_email: Mapped[str | None] = mapped_column(String(255))
    # Person who physically picked up the t-shirt. Null = picked up by the
    # owner themselves; otherwise the name/email of whoever showed an ID
    # card and signed for it on behalf of the registered participant.
    picked_up_by_name: Mapped[str | None] = mapped_column(String(255))
    picked_up_by_email: Mapped[str | None] = mapped_column(String(255))
    notes: Mapped[str | None] = mapped_column(Text)


class JudgeVisit(Base):
    """Floor-walk visit audit log — one row per individual visit event.

    Marked by an organizer at the team's desk via the Floor walk tab. Each
    call to /api/visits inserts a new row, so the same judge revisiting the
    same team on Day 2 produces a second row -- preserved as an audit trail
    of when each visit happened, what the judge said (notes), and which
    organizer logged it.

    Counting:
      - "how many UNIQUE judges visited team X" = SELECT COUNT(DISTINCT judge_id)
        WHERE team_id = X. Used by the stats tile + per-team count chips.
      - "total visit events for team X" = COUNT(*) WHERE team_id = X.
      - "list of Judge Y's visits to team X with timestamps" = SELECT *
        WHERE judge_id = Y AND team_id = X ORDER BY visited_at.

    NB: there is intentionally NO uq(judge_id, team_id) constraint -- the
    audit-log semantic requires multiple rows per pair.
    """
    __tablename__ = "judge_visits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # judge_id is nullable: organizers walk with groups of judges as a unit,
    # so 'a group visited this team at 10:32' is a meaningful row even when
    # we don't track which specific judges were in the group. Legacy rows
    # where a single judge was tagged still work; new rows from the
    # streamlined Add-visit flow are inserted with judge_id=NULL.
    judge_id: Mapped[int | None] = mapped_column(ForeignKey("judges.id", ondelete="CASCADE"), index=True, nullable=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"), index=True)
    visited_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    marked_by_email: Mapped[str | None] = mapped_column(String(255))  # organizer who tapped the toggle
    notes: Mapped[str | None] = mapped_column(Text)


class SwagExtra(Base):
    """People who need a swag kit but aren't team members or mentors.

    Covers judges, organisers, support staff, leadership, HR, etc. — anyone
    attending the event in a role outside the team rosters. Maintained
    separately from the `judges` table because most of these people don't
    need application access (no sign-in role) -- they just need to appear
    on the swag pickup list with the right t-shirt size and category badge.

    Bulk-loaded from an organizer-uploaded Excel; can also be added one at
    a time via the Swag admin panel. Joined with members + team-mentors at
    query time by _swag_roster() to build the canonical pickup list.
    """
    __tablename__ = "swag_extras"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)  # lowercased
    name: Mapped[str] = mapped_column(String(255))
    tshirt_size: Mapped[str | None] = mapped_column(String(16))
    country: Mapped[str | None] = mapped_column(String(64))
    category: Mapped[str] = mapped_column(String(64))  # 'Judge', 'Organiser', 'Support', 'Leadership', 'HR', ...
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class CommLog(Base):
    """Audit trail for every email / Teams message / channel-create action.

    Used by the dashboard to show 'history of communication' per team, and by
    the email composer to warn about duplicate sends within a window.
    """
    __tablename__ = "comm_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # ON DELETE SET NULL: when a Team is wiped (re-upload), we keep the
    # audit trail of what was sent — just null out the team reference.
    # Useful for compliance / post-event review even after the team rows
    # are gone.
    team_id: Mapped[int | None] = mapped_column(ForeignKey("teams.id", ondelete="SET NULL"), index=True)
    kind: Mapped[str] = mapped_column(String(32), index=True)  # email | teams_message | teams_broadcast | teams_channel_create
    template_id: Mapped[str | None] = mapped_column(String(64))
    subject: Mapped[str | None] = mapped_column(Text)
    body: Mapped[str | None] = mapped_column(Text)
    recipients: Mapped[list | None] = mapped_column(JSON, default=list)  # list[str] emails
    status: Mapped[str] = mapped_column(String(32), default="sent")  # sent | mocked | failed
    sent_by_email: Mapped[str | None] = mapped_column(String(255))
    sent_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    team: Mapped["Team | None"] = relationship()
