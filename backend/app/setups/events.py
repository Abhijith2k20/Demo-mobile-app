"""Event planning and production."""

SETUP = {
    "projectChannels": [{"name": "general"}, {"name": "vendors"}, {"name": "on-the-day"}, {"name": "budget", "private": True}],
    # The bot's status cards and escalations go here.
    "workChannel": "on-the-day",
    "jobTitles": [
        {"name": "Event Lead", "label": {"en": "Event Lead", "kn": "ಈವೆಂಟ್ ಲೀಡ್", "hi": "इवेंट लीड"}, "managersOnly": True,
         "channels": ["general", "vendors", "on-the-day"]},
        {"name": "Coordinator", "label": {"en": "Coordinator", "kn": "ಸಂಯೋಜಕ", "hi": "समन्वयक"}, "channels": ["vendors", "general"]},
        {"name": "Crew", "label": {"en": "Crew", "kn": "ತಂಡ", "hi": "क्रू"}, "channels": ["on-the-day", "general"], "simpleMode": True},
    ],
    "defaultJobTitle": "Crew",
    "problemTypes": [
        {"key": "Vendor late", "label": {"en": "Vendor late", "kn": "ವ್ಯಾಪಾರಿ ತಡ", "hi": "वेंडर देर से"}},
        {"key": "Equipment missing", "label": {"en": "Equipment missing", "kn": "ಉಪಕರಣ ಇಲ್ಲ", "hi": "सामान गायब"}},
        {"key": "Crew short", "label": {"en": "Crew short", "kn": "ತಂಡ ಕಡಿಮೆ", "hi": "क्रू कम"}},
    ],
}
