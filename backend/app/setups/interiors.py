"""Interior design and fit-out (Paliath Interiors' setup)."""

SETUP = {
    "projectChannels": [
        {"name": "general"}, {"name": "design"}, {"name": "site-work"}, {"name": "qs", "private": True},
    ],
    # The PM app's status cards go here.
    "workChannel": "site-work",
    "jobTitles": [
        {"name": "Project Manager", "managersOnly": True, "channels": ["general", "design", "site-work"]},
        {"name": "Designer", "channels": ["design", "general"]},
        {"name": "QS", "channels": ["qs", "general"]},
        {"name": "Supervisor", "channels": ["site-work", "general"]},
        {"name": "Worker", "channels": ["site-work", "general"], "simpleMode": True},
    ],
    "defaultJobTitle": "Worker",
    # Quick picks for "Report issue" and the bot's "Problem" answer; "Other" is always added by the app.
    "problemTypes": [
        {"key": "Material not arrived"},
        {"key": "Waiting for design"},
        {"key": "Labour short"},
        {"key": "Damage", "inCheckins": False},
    ],
}
