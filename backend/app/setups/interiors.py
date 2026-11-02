"""Interior design and fit-out (Paliath Interiors' setup)."""

SETUP = {
    "projectChannels": [
        {"name": "general"}, {"name": "design"}, {"name": "site-work"}, {"name": "qs", "private": True},
    ],
    # The bot's status cards and escalations go here.
    "workChannel": "site-work",
    "jobTitles": [
        {"name": "Project Manager", "label": {"en": "Project Manager", "kn": "ಪ್ರಾಜೆಕ್ಟ್ ಮ್ಯಾನೇಜರ್", "hi": "प्रोजेक्ट मैनेजर"},
         "managersOnly": True, "channels": ["general", "design", "site-work"]},
        {"name": "Designer", "label": {"en": "Designer", "kn": "ಡಿಸೈನರ್", "hi": "डिज़ाइनर"}, "channels": ["design", "general"]},
        {"name": "QS", "label": {"en": "QS", "kn": "QS", "hi": "QS"}, "channels": ["qs", "general"]},
        {"name": "Supervisor", "label": {"en": "Supervisor", "kn": "ಸೂಪರ್‌ವೈಸರ್", "hi": "सुपरवाइज़र"},
         "channels": ["site-work", "general"]},
        {"name": "Worker", "label": {"en": "Worker", "kn": "ಕೆಲಸಗಾರ", "hi": "कामगार"}, "channels": ["site-work", "general"],
         "simpleMode": True},
    ],
    "defaultJobTitle": "Worker",
    # Quick picks for "Report issue" and the bot's "Problem" answer; "Other" is always added by the app.
    "problemTypes": [
        {"key": "Material not arrived", "label": {"en": "Material not arrived", "kn": "ಸಾಮಗ್ರಿ ಬಂದಿಲ್ಲ", "hi": "सामान नहीं आया"}},
        {"key": "Waiting for design", "label": {"en": "Waiting for design", "kn": "ಡಿಸೈನ್\u200cಗಾಗಿ ಕಾಯುತ್ತಿದ್ದೇವೆ",
                                                "hi": "डिज़ाइन का इंतज़ार"}},
        {"key": "Labour short", "label": {"en": "Labour short", "kn": "ಕೆಲಸಗಾರರು ಕಡಿಮೆ", "hi": "मज़दूर कम हैं"}},
        {"key": "Damage", "label": {"en": "Damage", "kn": "ಹಾನಿ", "hi": "नुकसान"}, "inCheckins": False},
    ],
}
