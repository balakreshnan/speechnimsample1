# Voice Desk

Voice Desk is a business-focused Material Design 3 web interface backed by a native,
stateful NVIDIA voice agent. It provides a streaming voice workspace and an independent
text-chat tab.

The voice architecture follows the
[NVIDIA Nemotron Voice Agent blueprint](https://github.com/NVIDIA-AI-Blueprints/nemotron-voice-agent):

1. The browser opens a bidirectional WebRTC session to the Python Pipecat runtime.
2. NVIDIA Nemotron Streaming ASR (or multilingual Parakeet) produces live transcripts.
3. Voice activity detection and end-of-utterance handling finalize each natural turn.
4. A stateful Nemotron LLM retains the conversation context and streams its response.
5. NVIDIA Magpie TTS Multilingual streams speech back through the same WebRTC session.
6. New speech interrupts an in-progress response; the Stop button can also interrupt it.

Only the user's transcription appears in the Voice tab. The separate **Text chat** tab keeps
typed questions and written answers visible.

An optional reference-file control is shared by both tabs. When a file is active, Voice Desk
answers strictly from that file and says when the requested information is not present. Clearing
the file restores the normal general-knowledge behavior. Uploaded content is held in server
memory only, expires after four hours, and is not written to disk.

Supported context formats are PDF, DOCX, TXT, Markdown, CSV, JSON, XML, YAML, and LOG files up
to 10 MB. Up to 120,000 extracted characters are used; scanned PDFs need OCR before upload.

## Requirements

- Python 3.14 (the included `.venv` uses Python 3.14.7)
- Current Chrome or Edge with microphone permission
- `NVIDIA_BUILD_API_KEY` from build.nvidia.com in `.env` for hosted streaming ASR/TTS and Nemotron
- `NVIDIA_API_KEY` in `.env` for the independent Text chat and HTTPS fallback
- Internet access to NVIDIA's NVCF gRPC and NIM HTTPS endpoints

NVIDIA's upstream blueprint currently declares Python `>=3.12,<3.14`. This project installs
Pipecat 1.3.0 directly and has verified its NVIDIA STT, LLM, TTS, Silero VAD, FastAPI, and
Small WebRTC imports under Python 3.14.7. Docker is not used.

## Install

```powershell
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Pipecat uses NLTK's `punkt_tab` data for natural sentence chunking. Install it once if it is
not already present:

```powershell
python -c "import nltk; nltk.download('punkt_tab')"
```

## Run

```powershell
.\start.ps1
```

Open [http://127.0.0.1:7860](http://127.0.0.1:7860). The launcher starts both the web server
on port 7860 and the private native Pipecat signaling service on port 7861 in one process.

## Test

```powershell
.\.venv\Scripts\python.exe -m unittest discover -v
```

The automated suite mocks legacy HTTPS chat/TTS responses and validates the local agent
configuration without transmitting the API key.

## Configuration

Copy `.env.example` to `.env` if needed. Important values include:

- `NVIDIA_BUILD_API_KEY`: build.nvidia.com credential used by the blueprint-compatible
  gRPC ASR/TTS services and Nemotron NIM (normally starts with `nvapi-`)
- `NVIDIA_API_KEY`: Inference Hub credential used by Text chat and the HTTPS fallback
- Both credentials stay server-side and are never sent to browser JavaScript
- `NVIDIA_AGENT_LLM_MODEL`: stateful voice-agent LLM (Nemotron 3 Nano by default)
- `NVIDIA_AGENT_LLM_BASE_URL`: NVIDIA NIM-compatible LLM endpoint
- `NVIDIA_AGENT_SPEECH_SERVER`: NVIDIA streaming speech gRPC endpoint
- `NVIDIA_AGENT_ASR_*`: English Nemotron Streaming ASR selection
- `NVIDIA_AGENT_MULTILINGUAL_ASR_*`: multilingual Parakeet selection
- `NVIDIA_AGENT_TTS_VOICE`: default Magpie voice
- `VOICE_AGENT_VAD_STOP_SECS`: voice-activity end-of-turn pause threshold
- `VOICE_AGENT_HOST` / `VOICE_AGENT_PORT`: private Pipecat service binding
- `NVIDIA_CHAT_BASE_URL` / `NVIDIA_REASONER_MODEL`: models used by Text chat
- `GRADIO_SERVER_NAME` / `GRADIO_SERVER_PORT`: public local web binding (names retained for compatibility)

Never commit `.env`; it is ignored by Git.
