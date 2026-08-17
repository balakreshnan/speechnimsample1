"""Supported Voice Desk language, speaker, and emotion selections."""

from __future__ import annotations


LANGUAGES: dict[str, str] = {
    "en-US": "English",
    "es-US": "Spanish",
    "fr-FR": "French",
    "de-DE": "German",
    "zh-CN": "Mandarin",
    "vi-VN": "Vietnamese",
    "it-IT": "Italian",
    "hi-IN": "Hindi",
    "ja-JP": "Japanese",
    "ko-KR": "Korean",
    "ar-AR": "Arabic",
    "pt-BR": "Portuguese",
}

SPEAKERS = (
    "Aria",
    "Diego",
    "Isabela",
    "Jason",
    "Leo",
    "Louise",
    "Mia",
    "Pascal",
    "Ray",
    "Sofia",
)

# Profiles returned by the hosted NVIDIA Magpie ``/v1/audio/list_voices``
# catalog. Spoken language is selected independently, which allows these
# profiles to be used across every language exposed by Voice Desk.
SPEAKER_PROFILES: dict[str, dict[str, str | tuple[str, ...]]] = {
    "Aria": {
        "locale": "EN-US",
        "emotions": ("Neutral", "Calm", "Angry", "Sad"),
    },
    "Diego": {
        "locale": "ES-US",
        "emotions": ("Neutral", "Calm", "Angry", "Happy", "PleasantSurprised"),
    },
    "Isabela": {
        "locale": "ES-US",
        "emotions": ("Neutral", "Calm", "Sad", "Angry", "Happy"),
    },
    "Jason": {
        "locale": "EN-US",
        "emotions": ("Neutral", "Calm", "Angry", "Happy"),
    },
    "Leo": {
        "locale": "EN-US",
        "emotions": ("Neutral", "Calm", "Angry", "Sad"),
    },
    "Louise": {"locale": "FR-FR", "emotions": ()},
    "Mia": {
        "locale": "EN-US",
        "emotions": ("Neutral", "Calm", "Angry", "Sad"),
    },
    "Pascal": {
        "locale": "FR-FR",
        "emotions": ("Neutral", "Calm", "Happy", "Sad"),
    },
    "Ray": {
        "locale": "EN-US",
        "emotions": ("Neutral", "Calm", "Angry", "Fearful"),
    },
    "Sofia": {
        "locale": "EN-US",
        "emotions": ("Neutral", "Calm", "Angry", "Fearful"),
    },
}

EMOTIONS: dict[str, str] = {
    "Angry": "Angry tone",
    "Calm": "Calm tone",
    "Fearful": "Fearful tone",
    "Happy": "Happy tone",
    "Neutral": "Neutral tone",
    "Sad": "Sad tone",
    "PleasantSurprised": "Pleasantly surprised",
    "Disgust": "Disgusted tone",
}

# Pipecat's language enum identifies Arabic with ar-XA. NVIDIA's voice catalog
# and the Voice Desk interface use ar-AR, so only the service language is mapped.
NVIDIA_LANGUAGE_ALIASES = {"ar-AR": "ar-XA"}


def nvidia_language_code(language: str) -> str:
    """Validate a UI locale and return the NVIDIA/Pipecat service locale."""

    value = str(language or "").strip()
    if value == "ar-XA":
        return value
    if value not in LANGUAGES:
        raise ValueError("Unsupported language selection.")
    return NVIDIA_LANGUAGE_ALIASES.get(value, value)


def build_magpie_voice(language: str, speaker: str, emotion: str) -> str:
    """Build the hierarchical Magpie voice identifier for a UI selection."""

    nvidia_language_code(language)
    speaker = str(speaker or "").strip()
    emotion = str(emotion or "").strip()
    profile = SPEAKER_PROFILES.get(speaker)
    if profile is None:
        raise ValueError("Unsupported speaker selection.")
    if emotion not in EMOTIONS:
        raise ValueError("Unsupported emotion selection.")
    variants = tuple(profile["emotions"])
    supported = variants or ("Neutral",)
    if emotion not in supported:
        raise ValueError(f"{speaker} does not support the {emotion} emotion.")
    base_voice = f"Magpie-Multilingual.{profile['locale']}.{speaker}"
    return f"{base_voice}.{emotion}" if variants else base_voice


def public_voice_catalog() -> dict[str, object]:
    """Return browser-safe compatibility data for dependent dropdowns."""

    return {
        "emotions": dict(EMOTIONS),
        "speakers": {
            speaker: {
                "voice_locale": profile["locale"],
                "emotions": list(tuple(profile["emotions"]) or ("Neutral",)),
            }
            for speaker, profile in SPEAKER_PROFILES.items()
        },
    }
