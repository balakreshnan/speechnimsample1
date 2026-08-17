from __future__ import annotations

import http.client
import io
import json
import os
import threading
import unittest
import zipfile
from unittest.mock import patch

import app
from text_utils import plain_conversation_text
from voice_catalog import EMOTIONS, LANGUAGES, SPEAKERS, build_magpie_voice


class VoiceDeskIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server = app.build_server("127.0.0.1", 0)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def setUp(self) -> None:
        self.old_api_key = os.environ.get("NVIDIA_API_KEY")
        os.environ["NVIDIA_API_KEY"] = "test-key-never-sent-to-client"

    def tearDown(self) -> None:
        with app._context_lock:
            app._uploaded_contexts.clear()
        if self.old_api_key is None:
            os.environ.pop("NVIDIA_API_KEY", None)
        else:
            os.environ["NVIDIA_API_KEY"] = self.old_api_key

    def request(
        self, method: str, path: str, payload: dict | None = None
    ) -> tuple[int, dict[str, str], bytes]:
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        body = json.dumps(payload).encode() if payload is not None else None
        headers = {"Content-Type": "application/json"} if payload is not None else {}
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    def raw_request(
        self,
        method: str,
        path: str,
        body: bytes = b"",
        headers: dict[str, str] | None = None,
    ) -> tuple[int, dict[str, str], bytes]:
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    def test_home_page_and_static_asset_are_served(self) -> None:
        status, headers, body = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn("text/html", headers["Content-Type"])
        self.assertIn(b"Voice Desk", body)
        for locale in LANGUAGES:
            self.assertIn(f'value="{locale}"'.encode(), body)
        for speaker in SPEAKERS:
            self.assertIn(f'value="{speaker}"'.encode(), body)
        for emotion in EMOTIONS:
            self.assertIn(f'value="{emotion}"'.encode(), body)
        self.assertIn(b'id="voiceError"', body)

        status, headers, body = self.request("GET", "/static/app.js")
        self.assertEqual(status, 200)
        self.assertIn("javascript", headers["Content-Type"])
        self.assertIn(b"startRecording", body)
        self.assertIn(b"RTCPeerConnection", body)
        self.assertIn(b"applyVoiceCompatibility", body)
        self.assertIn(b"emotionSelect", body)
        self.assertIn(b"showVoiceError", body)
        self.assertNotIn(b"SpeechRecognition", body)

        status, headers, body = self.request("GET", "/static/styles.css")
        self.assertEqual(status, 200)
        self.assertIn("text/css", headers["Content-Type"])
        self.assertIn(b"grid-template-columns: repeat(2, minmax(0, 1fr))", body)
        self.assertIn(b"height: calc(100vh - 64px)", body)

    def test_health_reports_configuration_without_exposing_key(self) -> None:
        status, _, body = self.request("GET", "/api/health")
        payload = json.loads(body)
        self.assertEqual(status, 200)
        self.assertTrue(payload["api_key_configured"])
        self.assertNotIn("test-key-never-sent-to-client", body.decode())
        self.assertEqual(payload["tts_model"], app.DEFAULT_TTS_MODEL)
        self.assertEqual(payload["voice_agent"]["runtime"], "pipecat-native")
        self.assertEqual(
            payload["voice_catalog"]["speakers"]["Aria"]["emotions"],
            ["Neutral", "Calm", "Angry", "Sad"],
        )
        self.assertIn("Disgust", payload["voice_catalog"]["emotions"])

    @patch("app.request_agent")
    def test_webrtc_offer_is_proxied_to_native_agent(self, request_agent) -> None:
        request_agent.return_value = {"sdp": "answer-sdp", "type": "answer", "pc_id": "pc-1"}
        offer = {
            "sdp": "offer-sdp",
            "type": "offer",
            "request_data": {
                "language": "ar-AR",
                "speaker": "Sofia",
                "emotion": "Calm",
            },
        }
        status, _, body = self.request("POST", "/api/agent/offer", offer)

        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["pc_id"], "pc-1")
        forwarded = request_agent.call_args.args[1]
        self.assertEqual(forwarded["request_data"]["language"], "ar-XA")
        self.assertEqual(
            forwarded["request_data"]["voice"],
            "Magpie-Multilingual.EN-US.Sofia.Calm",
        )
        self.assertEqual(forwarded["request_data"]["speaker"], "Sofia")
        self.assertEqual(forwarded["request_data"]["emotion"], "Calm")

    @patch("app._upstream_request")
    def test_chat_endpoint_returns_reasoned_answer(self, upstream) -> None:
        upstream.return_value = (
            200,
            {"Content-Type": "application/json"},
            json.dumps(
                {
                    "choices": [
                        {
                            "message": {
                                "content": "<think>draft</think>**A concise answer.**"
                            }
                        }
                    ]
                }
            ).encode(),
        )
        status, _, body = self.request(
            "POST", "/api/chat", {"message": "What should I prioritize?", "history": []}
        )
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["answer"], "A concise answer.")

        outgoing = upstream.call_args.args[0]
        sent = json.loads(outgoing.data)
        self.assertEqual(sent["messages"][-1]["content"], "What should I prioritize?")
        self.assertEqual(outgoing.headers["Authorization"], "Bearer test-key-never-sent-to-client")
        self.assertIn("plain conversational text only", sent["messages"][0]["content"])

    def test_markdown_is_normalized_for_display_and_speech(self) -> None:
        response = (
            "## **Summary**\n"
            "* Read the [first chapter](https://example.test/chapter).\n"
            "- Use `clear language`.\n"
            "> This is *important*."
        )

        normalized = plain_conversation_text(response)

        self.assertEqual(
            normalized,
            "Summary\nRead the first chapter.\nUse clear language.\nThis is important.",
        )
        self.assertNotIn("*", normalized)

    @patch("app._upstream_request")
    def test_uploaded_context_strictly_grounds_chat_and_can_be_cleared(self, upstream) -> None:
        context_id = "context-session-1234"
        status, _, body = self.raw_request(
            "POST",
            "/api/context",
            b"Project Aurora launches on October 12. The owner is Priya.",
            {
                "Content-Type": "text/plain",
                "X-Context-ID": context_id,
                "X-File-Name": "project-notes.txt",
            },
        )
        uploaded = json.loads(body)
        self.assertEqual(status, 201)
        self.assertTrue(uploaded["active"])
        self.assertEqual(uploaded["filename"], "project-notes.txt")

        upstream.return_value = (
            200,
            {"Content-Type": "application/json"},
            json.dumps({"choices": [{"message": {"content": "October 12."}}]}).encode(),
        )
        status, _, body = self.request(
            "POST",
            "/api/chat",
            {"message": "When does it launch?", "history": [], "context_id": context_id},
        )
        result = json.loads(body)
        self.assertEqual(status, 200)
        self.assertTrue(result["grounded"])
        self.assertEqual(result["context_filename"], "project-notes.txt")
        sent = json.loads(upstream.call_args.args[0].data)
        system_prompt = sent["messages"][0]["content"]
        self.assertIn("using only facts explicitly supported", system_prompt)
        self.assertIn("Project Aurora launches on October 12", system_prompt)
        self.assertIn("untrusted source material", system_prompt)

        status, _, body = self.raw_request(
            "DELETE", "/api/context", headers={"X-Context-ID": context_id}
        )
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)["cleared"])
        self.assertIsNone(app.get_uploaded_context(context_id))

    @patch("app.request_agent")
    def test_uploaded_context_is_injected_server_side_into_voice_session(self, request_agent) -> None:
        context_id = "voice-context-1234"
        context = app.extract_context_file("brief.md", b"Revenue target: 42 million dollars.")
        app.put_uploaded_context(context_id, context)
        request_agent.return_value = {"sdp": "answer-sdp", "type": "answer"}
        offer = {
            "sdp": "offer-sdp",
            "type": "offer",
            "request_data": {"language": "en-US", "voice": "Aria", "context_id": context_id},
        }

        status, _, _ = self.request("POST", "/api/agent/offer", offer)

        self.assertEqual(status, 200)
        forwarded = request_agent.call_args.args[1]
        self.assertNotIn("context_id", forwarded["request_data"])
        self.assertEqual(forwarded["request_data"]["context_filename"], "brief.md")
        self.assertIn("Revenue target", forwarded["request_data"]["document_context"])

    def test_docx_context_extraction_and_unsupported_type_validation(self) -> None:
        self.assertEqual(app.MAX_CONTEXT_FILE_BYTES, 50 * 1024 * 1024)
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr(
                "word/document.xml",
                '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Quarterly plan</w:t></w:r></w:p></w:body></w:document>',
            )
        extracted = app.extract_context_file("plan.docx", buffer.getvalue())
        self.assertEqual(extracted.text, "Quarterly plan")

        with self.assertRaises(app.ApiError) as raised:
            app.extract_context_file("malware.exe", b"not allowed")
        self.assertEqual(raised.exception.status, 400)

        status, _, body = self.request(
            "POST",
            "/api/chat",
            {
                "message": "Use my file.",
                "history": [],
                "context_id": "missing-context-1234",
            },
        )
        self.assertEqual(status, 410)
        self.assertIn("no longer available", json.loads(body)["error"])

    def test_pdf_context_extraction_on_python_314(self) -> None:
        stream = b"BT /F1 12 Tf 72 720 Td (PDF context extraction works.) Tj ET"
        objects = [
            b"<< /Type /Catalog /Pages 2 0 R >>",
            b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
            b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        ]
        pdf = bytearray(b"%PDF-1.4\n")
        offsets = [0]
        for number, item in enumerate(objects, start=1):
            offsets.append(len(pdf))
            pdf.extend(f"{number} 0 obj\n".encode() + item + b"\nendobj\n")
        xref = len(pdf)
        pdf.extend(f"xref\n0 {len(objects) + 1}\n".encode())
        pdf.extend(b"0000000000 65535 f \n")
        for offset in offsets[1:]:
            pdf.extend(f"{offset:010d} 00000 n \n".encode())
        pdf.extend(
            f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
        )

        extracted = app.extract_context_file("reference.pdf", bytes(pdf))

        self.assertIn("[Page 1]", extracted.text)
        self.assertIn("PDF context extraction works", extracted.text)

    @patch("app._upstream_request")
    def test_synthesize_endpoint_returns_wav_audio_as_multipart(self, upstream) -> None:
        wav = b"RIFF" + (b"\x00" * 40)
        upstream.return_value = (200, {"Content-Type": "audio/wav"}, wav)
        status, headers, body = self.request(
            "POST",
            "/api/synthesize",
            {
                "text": "Hello from Voice Desk.",
                "language": "hi-IN",
                "speaker": "Isabela",
                "emotion": "Happy",
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "audio/wav")
        self.assertEqual(body[:4], b"RIFF")

        outgoing = upstream.call_args.args[0]
        self.assertIn("multipart/form-data", outgoing.headers["Content-type"])
        self.assertIn(b'name="encoding"\r\n\r\nLINEAR_PCM', outgoing.data)
        self.assertIn(b'name="sample_rate_hz"\r\n\r\n22050', outgoing.data)
        self.assertIn(b'name="language"\r\n\r\nhi-IN', outgoing.data)
        self.assertIn(
            b'name="voice"\r\n\r\nMagpie-Multilingual.ES-US.Isabela.Happy',
            outgoing.data,
        )

    def test_invalid_requests_are_rejected_before_upstream_call(self) -> None:
        status, _, body = self.request("POST", "/api/chat", {"message": "", "history": []})
        self.assertEqual(status, 400)
        self.assertIn("question", json.loads(body)["error"].lower())

        status, _, body = self.request(
            "POST",
            "/api/synthesize",
            {"text": "Hello", "language": "invalid language", "voice": "Voice"},
        )
        self.assertEqual(status, 400)
        self.assertIn("language", json.loads(body)["error"].lower())

        status, _, body = self.request(
            "POST",
            "/api/synthesize",
            {
                "text": "Hello",
                "language": "en-US",
                "speaker": "Unknown",
                "emotion": "Calm",
            },
        )
        self.assertEqual(status, 400)
        self.assertIn("speaker", json.loads(body)["error"].lower())

        status, _, body = self.request(
            "POST",
            "/api/synthesize",
            {
                "text": "Hello",
                "language": "en-US",
                "speaker": "Aria",
                "emotion": "Happy",
            },
        )
        self.assertEqual(status, 400)
        self.assertIn("does not support", json.loads(body)["error"].lower())

    @patch("app.time.sleep")
    @patch("app.urlopen")
    def test_transient_network_failure_is_retried(self, opener, _sleep) -> None:
        class FakeResponse:
            status = 200
            headers = {"Content-Type": "application/json"}

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return b'{"ok": true}'

        opener.side_effect = [app.URLError("temporary network issue"), FakeResponse()]
        status, _, body = app._upstream_request(app.Request("https://example.test"))

        self.assertEqual(status, 200)
        self.assertEqual(body, b'{"ok": true}')
        self.assertEqual(opener.call_count, 2)
        _sleep.assert_called_once()

    def test_native_agent_uses_blueprint_models_on_python_314(self) -> None:
        import voice_agent

        settings = voice_agent.get_agent_settings()
        self.assertEqual(settings.llm_model, "nvidia/nemotron-3-nano-30b-a3b")
        self.assertEqual(settings.asr_model, "nemotron-asr-streaming")
        self.assertEqual(
            settings.default_voice,
            "Magpie-Multilingual.EN-US.Aria",
        )
        language, voice = voice_agent._session_preferences(
            {
                "language": "ar-AR",
                "speaker": "Ray",
                "emotion": "Fearful",
            },
            settings,
        )
        self.assertEqual(language.value, "ar-XA")
        self.assertEqual(
            voice,
            "Magpie-Multilingual.EN-US.Ray.Fearful",
        )
        self.assertEqual(
            build_magpie_voice("pt-BR", "Diego", "PleasantSurprised"),
            "Magpie-Multilingual.ES-US.Diego.PleasantSurprised",
        )
        with self.assertRaises(ValueError):
            build_magpie_voice("pt-BR", "Diego", "Disgust")
        visible_error = voice_agent._user_facing_pipeline_error(
            "INVALID_ARGUMENT: subvoice requested not found",
            "Aria",
            "Happy",
        )
        self.assertIn("Aria does not support the Happy emotion", visible_error)
        grounded = voice_agent._session_system_prompt(
            {
                "context_filename": "policy.txt",
                "document_context": "Travel reimbursement is capped at $500.",
            }
        )
        self.assertIn("using only facts explicitly supported", grounded)
        self.assertIn("Travel reimbursement is capped at $500", grounded)
        self.assertIn("untrusted source material", grounded)
        self.assertIn("plain conversational text only", grounded)


if __name__ == "__main__":
    unittest.main()
