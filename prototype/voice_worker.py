"""Persistent Chatterbox worker for Noor's local Node demo."""

import base64
import io
import json
import os
import sys
from contextlib import redirect_stdout
from pathlib import Path


REFERENCE = os.getenv("NOOR_VOICE_REFERENCE", "").strip()
model = None


def load_model():
    global model
    with redirect_stdout(sys.stderr):
        import torch
        from chatterbox.tts_turbo import ChatterboxTurboTTS

        if model is None:
            device = "cuda" if torch.cuda.is_available() else "cpu"
            model = ChatterboxTurboTTS.from_pretrained(device=device)
    return model


def speak(text):
    with redirect_stdout(sys.stderr):
        import torch
        import torchaudio as ta

        loaded_model = load_model()
        with torch.inference_mode():
            if REFERENCE:
                reference_path = Path(REFERENCE).expanduser()
                if not reference_path.is_absolute():
                    reference_path = Path(__file__).resolve().parent / reference_path
                if not reference_path.is_file():
                    raise FileNotFoundError("Configured voice reference was not found")
                waveform = loaded_model.generate(text, audio_prompt_path=str(reference_path))
            else:
                waveform = loaded_model.generate(text)
        output = io.BytesIO()
        ta.save(output, waveform.cpu(), loaded_model.sr, format="wav")
    return base64.b64encode(output.getvalue()).decode("ascii")


for line in sys.stdin:
    request = None
    try:
        request = json.loads(line)
        if request.get("kind") == "warmup":
            load_model()
            response = {"id": request["id"], "ready": True}
        else:
            text = request["text"].strip()
            if not text or len(text) > 900:
                raise ValueError("Invalid speech text")
            response = {"id": request["id"], "audio": speak(text)}
    except Exception as error:
        response = {"id": request.get("id") if isinstance(request, dict) else None, "error": str(error)}
    print(json.dumps(response), flush=True)
