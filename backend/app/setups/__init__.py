"""Industry templates. A new company's setup is a copy of one, which the Siteline team can then edit."""
from . import events, general, interiors

TEMPLATES = {"interiors": interiors.SETUP, "events": events.SETUP, "general": general.SETUP}
