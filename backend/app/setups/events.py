"""Event planning and production."""

SETUP = {
    "projectChannels": [{"name": "general"}, {"name": "vendors"}, {"name": "on-the-day"}, {"name": "budget", "private": True}],
    # The bot's status cards and escalations go here.
    "workChannel": "on-the-day",
    "jobTitles": [
        {"name": "Event Lead", "managersOnly": True, "channels": ["general", "vendors", "on-the-day"]},
        {"name": "Coordinator", "channels": ["vendors", "general"]},
        {"name": "Crew", "channels": ["on-the-day", "general"], "simpleMode": True},
    ],
    "defaultJobTitle": "Crew",
    "problemTypes": [
        {"key": "Vendor late"},
        {"key": "Equipment missing"},
        {"key": "Crew short"},
    ],
}
