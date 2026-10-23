"""Persistent Chatterbox worker for Noor's local Node demo."""

import base64
import io
import hashlib
from importlib.metadata import version
import json
import os
import sys
from contextlib import redirect_stdout
from pathlib import Path


REFERENCE = os.getenv("NOOR_VOICE_REFERENCE", "").strip()
model = None
voice_identity = None


def load_model():
    global model, voice_identity
    with redirect_stdout(sys.stderr):
        import torch
        from chatterbox.tts_turbo import ChatterboxTurboTTS

        if model is None:
            device = "cuda" if torch.cuda.is_available() else "cpu"
            reference_path = None
            reference_hash = "builtin-default"
            if REFERENCE:
                reference_path = Path(REFERENCE).expanduser()
                if not reference_path.is_absolute():
                    reference_path = Path(__file__).resolve().parent / reference_path
                if not reference_path.is_file():
                    raise FileNotFoundError("Configured voice reference was not found")
                reference_hash = hashlib.sha256(reference_path.read_bytes()).hexdigest()
            prepared = ChatterboxTurboTTS.from_pretrained(device=device)
            if reference_path:
                with torch.inference_mode():
                    prepared.prepare_conditionals(str(reference_path), exaggeration=0.0)
            voice_identity = f"chatterbox-tts@{version('chatterbox-tts')}:{reference_hash}"
            model = prepared
    return model


def speak(text):
    with redirect_stdout(sys.stderr):
        import soundfile as sf
        import torch

        loaded_model = load_model()
        with torch.inference_mode():
            waveform = loaded_model.generate(text)
        output = io.BytesIO()
        # torchaudio >= 2.9 needs the separate torchcodec package to save; soundfile writes the same 32-bit float WAV.
        sf.write(output, waveform.cpu().squeeze(0).numpy(), loaded_model.sr, format="WAV", subtype="FLOAT")
    return base64.b64encode(output.getvalue()).decode("ascii")


for line in sys.stdin:
    request = None
    try:
        request = json.loads(line)
        if request.get("kind") in ("warmup", "identity"):
            load_model()
            response = {"id": request["id"], "ready": True, "identity": voice_identity}
        else:
            text = request["text"].strip()
            if not text or len(text) > 900:
                raise ValueError("Invalid speech text")
            response = {"id": request["id"], "audio": speak(text)}
    except Exception as error:
        response = {"id": request.get("id") if isinstance(request, dict) else None, "error": str(error)}
    print(json.dumps(response), flush=True)
