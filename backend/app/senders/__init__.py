"""Outgoing email and push. Each has one function; without its keys it only logs, which is what
development and tests use. Production refuses to start a sender without keys (it raises in the job, which
retries and then shows up in Sentry)."""
