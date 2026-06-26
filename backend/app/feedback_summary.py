"""Judge-comment summarization and Teams-channel posting.

For each team in a given round, gathers JudgeScore.comment rows, calls the
LLM to synthesize a single message the team can read in their Teams channel,
and (separately) posts the approved text via Graph.

The summary is stored on Team.feedback_summary[round_key] so the organizer
can edit it before posting, and we have a record of what went out.

Provider selection lives in llm.py. We default to the 'fast' Anthropic model
(Haiku) since per-team summaries are cheap and short.
"""
from __future__ import annotations

import html
import logging
from datetime import datetime

import httpx
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from . import models
from .comms import GRAPH, PARENT_TEAM_ID, _GraphChannelError, _graph_get_user_id, log
from .llm import LLMError, call_text


logger = logging.getLogger("feedback_summary")


def round_key(round_num: int) -> str:
    """Stable key into Team.feedback_summary for a given round."""
    return f"r{int(round_num)}"


def gather_comments(db: Session, team: models.Team, round_num: int) -> list[str]:
    """Return non-empty judge comments for this team + round, one string per
    judge. Judge identity is intentionally NOT returned -- the team-facing
    summary is anonymized."""
    rows = (
        db.query(models.JudgeScore)
        .filter(
            models.JudgeScore.team_id == team.id,
            models.JudgeScore.round == round_num,
        )
        .all()
    )
    out: list[str] = []
    for r in rows:
        text = (r.comment or "").strip()
        if text:
            out.append(text)
    return out


_SYSTEM_PROMPT = (
    "You are summarizing anonymous judge feedback from a corporate "
    "hackathon (RealHack 2026) for the team that built the project. "
    "The summary is posted in the team's Microsoft Teams channel, so the "
    "team will read it directly. Rules:\n"
    "1) Tone: encouraging, professional, specific. Address the team as 'your team'.\n"
    "2) Structure (in this exact order):\n"
    "   - A 1-2 sentence opening that recognizes what the judges liked.\n"
    "   - 2-4 short bullet points of constructive feedback, phrased as 'consider...' or 'you could strengthen...' (never blame).\n"
    "   - A single closing sentence wishing them well.\n"
    "3) Never mention or attribute any judge by name or role.\n"
    "4) Do not invent feedback that isn't in the source comments.\n"
    "5) If multiple judges said the same thing, consolidate -- don't repeat.\n"
    "6) Keep it under 180 words.\n"
    "7) Output plain text only. No markdown headers, no JSON, no preamble."
)


def summarize_team_feedback(team_name: str, round_num: int, comments: list[str]) -> str:
    """Call the LLM to produce a team-facing summary. Returns plain text.

    Raises LLMError on provider failure -- the caller decides how to surface
    that (we don't want to silently store a bad summary).
    """
    if not comments:
        raise ValueError("no comments to summarize")
    bullet_block = "\n\n".join(f"- {c}" for c in comments)
    user_msg = (
        f"Team: {team_name}\n"
        f"Round: {round_num}\n\n"
        f"Anonymous judge comments ({len(comments)}):\n\n"
        f"{bullet_block}\n\n"
        f"Write the team-facing summary now."
    )
    result = call_text(
        [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        smart=False,
    )
    text = (result.data.get("text") or "").strip()
    if not text:
        raise LLMError("LLM returned empty text")
    return text


def get_summary_state(team: models.Team, round_num: int) -> dict | None:
    """Return the persisted summary state for this team + round, or None."""
    blob = team.feedback_summary or {}
    return blob.get(round_key(round_num))


def store_summary(
    db: Session,
    team: models.Team,
    round_num: int,
    summary: str,
    *,
    comment_count: int,
    generated_by_email: str | None,
    is_edit: bool = False,
) -> dict:
    """Persist a generated or edited summary. Returns the stored block."""
    now = datetime.utcnow().isoformat()
    blob = dict(team.feedback_summary or {})
    prior = blob.get(round_key(round_num)) or {}
    if is_edit:
        entry = {
            **prior,
            "summary": summary,
            "edited_at": now,
        }
    else:
        entry = {
            "summary": summary,
            "comment_count": comment_count,
            "generated_at": now,
            "generated_by_email": generated_by_email,
            "edited_at": None,
            # Preserve post state if a prior generation was already posted --
            # but mark it stale by clearing posted_at so the organizer knows
            # the channel message reflects an older summary. Conservative
            # default: clear it.
            "posted_at": None,
            "posted_message_id": None,
        }
    blob[round_key(round_num)] = entry
    team.feedback_summary = blob
    flag_modified(team, "feedback_summary")
    db.commit()
    db.refresh(team)
    return entry


def post_summary_to_channel(
    db: Session,
    team: models.Team,
    round_num: int,
    summary_text: str,
    graph_token: str,
    sent_by_email: str | None,
) -> dict:
    """Post the (already-approved) summary text to the team's Teams channel.

    Mentions the team's mentor + members so the message lights up their
    notifications. Returns {message_id, mentions_count, status}.

    Updates Team.feedback_summary[round_key].posted_at / posted_message_id.
    """
    if not team.has_teams_channel or not team.teams_channel_id:
        raise _GraphChannelError(400, "Team has no Teams channel -- create one first")
    if not PARENT_TEAM_ID:
        raise _GraphChannelError(500, "GRAPH_PARENT_TEAM_ID is not set on the server")

    with httpx.Client(
        headers={"Authorization": f"Bearer {graph_token}", "Content-Type": "application/json"},
        timeout=30,
    ) as gc:
        # Resolve mentor + members to AAD ids for @mentions. Skip silently
        # if a name/email can't be resolved -- the message still posts.
        people: list[dict] = []
        if team.mentor_email and team.mentor_name:
            uid = _graph_get_user_id(gc, team.mentor_email.strip())
            if uid:
                people.append({"name": team.mentor_name.strip().title(), "aad_id": uid})
        for m in team.members:
            if m.email and m.name:
                uid = _graph_get_user_id(gc, m.email.strip())
                if uid:
                    people.append({"name": m.name.strip().title(), "aad_id": uid})

        mentions: list[dict] = []
        mention_tags: list[str] = []
        for i, p in enumerate(people):
            mentions.append({
                "id": i,
                "mentionText": p["name"],
                "mentioned": {
                    "user": {
                        "displayName": p["name"],
                        "id": p["aad_id"],
                        "userIdentityType": "aadUser",
                    },
                },
            })
            mention_tags.append(f'<at id="{i}">{html.escape(p["name"])}</at>')

        team_name_safe = html.escape(team.name)
        # Render the LLM text into HTML. The LLM output is plain text with
        # newlines and '-' bullets; convert to <p>/<ul>/<li> structure so it
        # reads cleanly in Teams (which collapses runs of \n into one line).
        body_html = _summary_to_html(summary_text)
        mentions_block = ", ".join(mention_tags) if mention_tags else ""

        header_label = f"Round {int(round_num)}" if round_num == 1 else f"Round {int(round_num)}"
        content = (
            f'<p><strong style="color:#0a4f99;font-size:16px;">'
            f'📝 {header_label} judge feedback for {team_name_safe}</strong></p>'
            f'{body_html}'
            f'<p>Regards,<br>'
            f'<strong style="color:#0a4f99;">Team RealHack</strong></p>'
        )
        if mentions_block:
            content += f"<p>{mentions_block}</p>"

        payload = {
            "body": {"contentType": "html", "content": content},
            "mentions": mentions,
        }
        url = f"{GRAPH}/teams/{PARENT_TEAM_ID}/channels/{team.teams_channel_id}/messages"
        r = gc.post(url, json=payload)
        if r.status_code not in (200, 201):
            req_id = r.headers.get("request-id") or r.headers.get("client-request-id") or "?"
            raise _GraphChannelError(
                502,
                f"Feedback summary post failed ({r.status_code}) [req {req_id}]: {r.text[:1500]}",
            )
        msg_id = (r.json() or {}).get("id", "")

    # Persist post state.
    now = datetime.utcnow().isoformat()
    blob = dict(team.feedback_summary or {})
    entry = dict(blob.get(round_key(round_num)) or {})
    entry["posted_at"] = now
    entry["posted_message_id"] = msg_id
    blob[round_key(round_num)] = entry
    team.feedback_summary = blob
    flag_modified(team, "feedback_summary")

    log(
        db, team.id, kind="teams_message",
        subject=f"Round {round_num} feedback summary posted: {team.name}",
        body=f"Message ID: {msg_id} · {len(mentions)} @mention(s)",
        status="sent",
        sent_by_email=sent_by_email,
    )
    db.commit()
    return {"message_id": msg_id, "mentions_count": len(mentions), "status": "sent"}


def _summary_to_html(text: str) -> str:
    """Convert the LLM plaintext summary to Teams-friendly HTML.

    Lines starting with '-' or '*' become <li> inside a <ul>; other non-
    empty lines become <p>. Adjacent bullet lines are grouped into one list.
    """
    lines = [ln.strip() for ln in (text or "").splitlines()]
    parts: list[str] = []
    bullet_buf: list[str] = []

    def flush_bullets():
        if not bullet_buf:
            return
        items = "".join(f"<li>{html.escape(b)}</li>" for b in bullet_buf)
        parts.append(f"<ul>{items}</ul>")
        bullet_buf.clear()

    for ln in lines:
        if not ln:
            flush_bullets()
            continue
        if ln.startswith("- ") or ln.startswith("* "):
            bullet_buf.append(ln[2:].strip())
        else:
            flush_bullets()
            parts.append(f"<p>{html.escape(ln)}</p>")
    flush_bullets()
    return "".join(parts) or "<p></p>"
