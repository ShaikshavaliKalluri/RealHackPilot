"""LLM service with multi-provider fallback.

Order of precedence:
  1. settings.llm_provider (openai | anthropic | mock) if its key is set
  2. The other real provider if its key is set
  3. Mock provider (always works, generates deterministic plausible output)

The same JSON-mode interface is exposed for both providers so callers don't care.
"""
from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from typing import Any

from .config import settings

logger = logging.getLogger("llm")

# Lazy SDK imports — avoid hard fail if a package isn't installed
try:
    from openai import OpenAI  # type: ignore
except Exception:  # pragma: no cover
    OpenAI = None  # type: ignore

try:
    from anthropic import Anthropic  # type: ignore
except Exception:  # pragma: no cover
    Anthropic = None  # type: ignore


@dataclass
class LLMResult:
    provider: str
    model: str
    data: dict
    raw_text: str


class LLMError(RuntimeError):
    pass


# ---------- Mock provider (always available) ----------

def _mock_score(payload: dict, schema: dict) -> dict:
    """Produce deterministic plausible scores based on the payload content.

    We hash the input to keep it stable, and derive 1-5 scores from text length
    and keyword presence so the demo looks reasonable.
    """
    text_blob = json.dumps(payload, sort_keys=True, default=str)
    h = int(hashlib.sha256(text_blob.encode()).hexdigest(), 16)

    def score(seed: int, base_text: str = "") -> int:
        # Bias upward when text is substantive
        bonus = 1 if len(base_text) > 80 else 0
        bonus += 1 if any(k in base_text.lower() for k in ("automation", "ai", "ml", "platform", "real", "tenant")) else 0
        v = ((h >> (seed * 4)) & 0x7) % 5 + 1  # 1..5
        return min(5, v + bonus)

    out: dict[str, Any] = {}
    for key, spec in schema.items():
        if spec.get("type") == "score":
            field = spec.get("from", "")
            text = str(payload.get(field, ""))
            out[key] = score(spec.get("seed", 0), text)
        elif spec.get("type") == "reason":
            field = spec.get("from", "")
            text = str(payload.get(field, ""))
            if not text or text.strip().lower() in ("tbd", "na", "n/a", "none"):
                out[key] = "Submission field is empty or placeholder."
            elif len(text) < 40:
                out[key] = "Submission is too brief to evaluate confidently."
            else:
                out[key] = "Submission appears coherent and on-topic at a glance."
        else:
            out[key] = spec.get("default")
    out["_provider"] = "mock"
    return out


# ---------- OpenAI provider ----------

def _call_openai(messages: list[dict], model: str, json_mode: bool = True) -> tuple[str, str]:
    if OpenAI is None:
        raise LLMError("openai SDK not installed")
    if not settings.openai_api_key:
        raise LLMError("OPENAI_API_KEY not set")
    client = OpenAI(api_key=settings.openai_api_key)
    kwargs: dict[str, Any] = {"model": model, "messages": messages, "temperature": 0.2}
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    try:
        resp = client.chat.completions.create(**kwargs)
    except Exception as e:  # pragma: no cover
        raise LLMError(f"OpenAI call failed: {e}") from e
    text = resp.choices[0].message.content or ""
    return text, model


# ---------- Anthropic provider ----------

def _call_anthropic(messages: list[dict], model: str) -> tuple[str, str]:
    if Anthropic is None:
        raise LLMError("anthropic SDK not installed")
    if not settings.anthropic_api_key:
        raise LLMError("ANTHROPIC_API_KEY not set")
    client = Anthropic(api_key=settings.anthropic_api_key)

    # Anthropic uses a `system` param separate from messages.
    system_msg = ""
    a_msgs: list[dict] = []
    for m in messages:
        if m["role"] == "system":
            system_msg = m["content"]
        else:
            a_msgs.append({"role": m["role"], "content": m["content"]})
    try:
        resp = client.messages.create(
            model=model,
            max_tokens=2048,
            temperature=0.2,
            system=system_msg or "Respond only with valid JSON.",
            messages=a_msgs,
        )
    except Exception as e:  # pragma: no cover
        raise LLMError(f"Anthropic call failed: {e}") from e
    text = resp.content[0].text if resp.content else ""
    return text, model


# ---------- Dispatcher ----------

def _providers_in_order() -> list[str]:
    order = [settings.llm_provider]
    for p in ("openai", "anthropic", "mock"):
        if p not in order:
            order.append(p)
    return order


def call_json(messages: list[dict], mock_payload: dict, mock_schema: dict, smart: bool = False) -> LLMResult:
    """Call an LLM expecting a JSON object back.

    `mock_payload` and `mock_schema` are used only if all real providers fail.
    """
    last_err: Exception | None = None
    for provider in _providers_in_order():
        try:
            if provider == "openai":
                model = settings.openai_model_smart if smart else settings.openai_model_fast
                text, used_model = _call_openai(messages, model, json_mode=True)
            elif provider == "anthropic":
                model = settings.anthropic_model_smart if smart else settings.anthropic_model_fast
                text, used_model = _call_anthropic(messages, model)
            elif provider == "mock":
                data = _mock_score(mock_payload, mock_schema)
                return LLMResult(provider="mock", model="deterministic", data=data, raw_text=json.dumps(data))
            else:
                continue

            try:
                data = json.loads(_extract_json(text))
            except json.JSONDecodeError:
                # Provider returned non-JSON — try the next one
                logger.warning("Provider %s returned non-JSON; trying next", provider)
                continue

            return LLMResult(provider=provider, model=used_model, data=data, raw_text=text)
        except LLMError as e:
            last_err = e
            logger.info("Provider %s skipped: %s", provider, e)
            continue
        except Exception as e:  # pragma: no cover
            last_err = e
            logger.exception("Provider %s crashed: %s", provider, e)
            continue

    raise LLMError(f"All LLM providers failed; last error: {last_err}")


def _extract_json(text: str) -> str:
    """Pull the first {...} JSON block out of a possibly-noisy LLM response."""
    text = text.strip()
    if text.startswith("{") and text.endswith("}"):
        return text
    # Strip code fences
    if "```" in text:
        parts = text.split("```")
        for p in parts:
            p = p.strip()
            if p.startswith("json"):
                p = p[4:].strip()
            if p.startswith("{") and p.endswith("}"):
                return p
    # Find first { ... last }
    i = text.find("{")
    j = text.rfind("}")
    if i != -1 and j != -1 and j > i:
        return text[i : j + 1]
    return text


# ---------- Health check ----------

def health_check() -> dict:
    """Test each configured provider independently and report which work."""
    test_messages = [
        {"role": "system", "content": "Reply with JSON only."},
        {"role": "user", "content": 'Return exactly: {"pong": true}'},
    ]

    out: dict[str, Any] = {
        "configured_primary": settings.llm_provider,
        "openai": {"key_set": bool(settings.openai_api_key), "working": False, "model": None, "error": None},
        "anthropic": {"key_set": bool(settings.anthropic_api_key), "working": False, "model": None, "error": None},
    }

    # ---- Test OpenAI ----
    if settings.openai_api_key:
        try:
            text, model = _call_openai(test_messages, settings.openai_model_fast, json_mode=True)
            data = json.loads(_extract_json(text))
            out["openai"]["working"] = bool(data.get("pong") is True)
            out["openai"]["model"] = model
        except Exception as e:
            out["openai"]["error"] = str(e)[:200]

    # ---- Test Anthropic ----
    if settings.anthropic_api_key:
        try:
            text, model = _call_anthropic(test_messages, settings.anthropic_model_fast)
            data = json.loads(_extract_json(text))
            out["anthropic"]["working"] = bool(data.get("pong") is True)
            out["anthropic"]["model"] = model
        except Exception as e:
            out["anthropic"]["error"] = str(e)[:200]

    # Effective active provider (what call_json would actually use)
    if out[settings.llm_provider]["working"]:
        out["active_provider"] = settings.llm_provider
    elif out["openai"]["working"]:
        out["active_provider"] = "openai"
    elif out["anthropic"]["working"]:
        out["active_provider"] = "anthropic"
    else:
        out["active_provider"] = "mock"

    return out
