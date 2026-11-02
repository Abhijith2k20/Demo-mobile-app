"""A neutral starting point for any field team."""

SETUP = {
    "projectChannels": [{"name": "general"}, {"name": "field"}, {"name": "managers", "private": True}],
    # The bot's status cards and escalations go here.
    "workChannel": "field",
    "jobTitles": [
        {"name": "Manager", "label": {"en": "Manager", "kn": "ಮ್ಯಾನೇಜರ್", "hi": "मैनेजर"}, "managersOnly": True,
         "channels": ["general", "field", "managers"]},
        {"name": "Team member", "label": {"en": "Team member", "kn": "ತಂಡದ ಸದಸ್ಯ", "hi": "टीम सदस्य"}, "channels": ["general", "field"]},
        {"name": "Field worker", "label": {"en": "Field worker", "kn": "ಕೆಲಸಗಾರ", "hi": "फ़ील्ड कर्मी"}, "channels": ["field", "general"],
         "simpleMode": True},
    ],
    "defaultJobTitle": "Team member",
    "problemTypes": [
        {"key": "Material not arrived", "label": {"en": "Material not arrived", "kn": "ಸಾಮಗ್ರಿ ಬಂದಿಲ್ಲ", "hi": "सामान नहीं आया"}},
        {"key": "Waiting on someone", "label": {"en": "Waiting on someone", "kn": "ಯಾರಿಗೋ ಕಾಯುತ್ತಿದ್ದೇವೆ", "hi": "किसी का इंतज़ार"}},
        {"key": "People short", "label": {"en": "People short", "kn": "ಜನ ಕಡಿಮೆ", "hi": "लोग कम हैं"}},
    ],
}
