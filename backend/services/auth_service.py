"""Stateless session handling: no database — the session is a signed,
self-contained cookie (email + name + expiry), verified on every request."""
from typing import Optional, TypedDict

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from config.settings import settings

SESSION_COOKIE_NAME = "rk_session"
SESSION_MAX_AGE = 60 * 60 * 24 * 30  # 30 days


class SessionUser(TypedDict):
    email: str
    name: str


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.SESSION_SECRET_KEY, salt="realm-keeper-session")


def create_session_token(email: str, name: str = "") -> str:
    return _serializer().dumps({"email": email, "name": name or email})


def verify_session_token(token: str) -> Optional[SessionUser]:
    try:
        data = _serializer().loads(token, max_age=SESSION_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return None
    # Re-checked on every request, not only at login: dropping someone from
    # ALLOWED_EMAILS must revoke their (up to 30-day) session immediately.
    if not is_email_allowed(data.get("email", "")):
        return None
    return {"email": data["email"], "name": data.get("name") or data["email"]}


def is_email_allowed(email: str) -> bool:
    return bool(email) and email.strip().lower() in settings.ALLOWED_EMAILS
