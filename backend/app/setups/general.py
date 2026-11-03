"""A neutral starting point for any field team."""

SETUP = {
    "projectChannels": [{"name": "general"}, {"name": "field"}, {"name": "managers", "private": True}],
    # The PM app's status cards go here.
    "workChannel": "field",
    "jobTitles": [
        {"name": "Manager", "managersOnly": True, "channels": ["general", "field", "managers"]},
        {"name": "Team member", "channels": ["general", "field"]},
        {"name": "Field worker", "channels": ["field", "general"], "simpleMode": True},
    ],
    "defaultJobTitle": "Team member",
    "problemTypes": [
        {"key": "Material not arrived"},
        {"key": "Waiting on someone"},
        {"key": "People short"},
    ],
}
