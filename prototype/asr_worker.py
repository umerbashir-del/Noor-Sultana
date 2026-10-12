"""Local speech recognition worker for Noor's recorded microphone clips."""

import base64
import io
import json
import sys
from contextlib import redirect_stdout

model = None


def transcribe(encoded_audio):
    global model
    with redirect_stdout(sys.stderr):
        from faster_whisper import WhisperModel

        if model is None:
            model = WhisperModel("base.en", device="cpu", compute_type="int8")
        audio = io.BytesIO(base64.b64decode(encoded_audio, validate=True))
        def recognize(use_vad):
            audio.seek(0)
            segments, _ = model.transcribe(
                audio,
                language="en",
                beam_size=5,
                vad_filter=use_vad,
                condition_on_previous_text=False,
            )
            return " ".join(
                segment.text.strip() for segment in segments
                if segment.no_speech_prob < 0.6
            ).strip()

        text = recognize(True) or recognize(False)
    if not text:
        raise ValueError("No clear speech detected.")
    return text[:500]


for line in sys.stdin:
    request = None
    try:
        request = json.loads(line)
        response = {"id": request["id"], "text": transcribe(request["audio"])}
    except Exception as error:
        response = {"id": request.get("id") if isinstance(request, dict) else None, "error": str(error)}
    print(json.dumps(response), flush=True)
