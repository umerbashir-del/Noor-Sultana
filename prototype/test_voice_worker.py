"""Worker lifecycle checks with fake ML modules; no model or network access."""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).with_name('voice_worker.py').read_text()


def run_worker(requests, reference='', fail_prepare=False):
    calls = {'loads': 0, 'prepare': [], 'generate': []}
    class Wave:
        def cpu(self):
            return self
    class Model:
        sr = 24000
        def prepare_conditionals(self, path, **kwargs):
            calls['prepare'].append((path, kwargs))
            if fail_prepare:
                raise ValueError('Reference preparation failed')
        def generate(self, text, **kwargs):
            calls['generate'].append((text, kwargs))
            return Wave()
    class Turbo:
        @staticmethod
        def from_pretrained(device):
            calls['loads'] += 1
            assert device == 'cpu'
            return Model()
    modules = {
        'torch': types.SimpleNamespace(cuda=types.SimpleNamespace(is_available=lambda: False), inference_mode=contextlib.nullcontext),
        'torchaudio': types.SimpleNamespace(save=lambda output, wave, rate, **kwargs: output.write(b'RIFF-fake-wav')),
        'chatterbox': types.ModuleType('chatterbox'),
        'chatterbox.tts_turbo': types.SimpleNamespace(ChatterboxTurboTTS=Turbo),
    }
    output = io.StringIO()
    with patch.dict(sys.modules, modules), patch.dict(os.environ, {'NOOR_VOICE_REFERENCE': reference}), patch('importlib.metadata.version', return_value='0.1.7'), patch('sys.stdin', io.StringIO(''.join(json.dumps(r)+'\n' for r in requests))), patch('sys.stdout', output):
        exec(compile(SOURCE, 'voice_worker.py', 'exec'), {})
    return [json.loads(line) for line in output.getvalue().splitlines()], calls


class VoiceWorkerTests(unittest.TestCase):
    def test_warmup_prepares_reference_once_and_generation_reuses_conditionals(self):
        with tempfile.TemporaryDirectory(prefix='noor-worker-test-') as folder:
            ref = Path(folder)/'reference.wav'
            ref.write_bytes(b'first-reference')
            responses, calls = run_worker([{'id': 1, 'kind': 'warmup'}, {'id': 2, 'text': 'Hello.'}, {'id': 3, 'text': 'Thank you.'}, {'id': 4, 'kind': 'identity'}], str(ref))
            self.assertEqual(calls['loads'], 1)
            self.assertEqual(calls['prepare'], [(str(ref), {'exaggeration': 0.0})])
            self.assertEqual(calls['generate'], [('Hello.', {}), ('Thank you.', {})])
            expected = 'chatterbox-tts@0.1.7:'+hashlib.sha256(b'first-reference').hexdigest()
            self.assertEqual(responses[0]['identity'], expected)
            self.assertEqual(responses[3]['identity'], expected)
            self.assertIn('audio', responses[1])
            ref.write_bytes(b'changed-reference-at-same-path')
            changed, _ = run_worker([{'id': 1, 'kind': 'identity'}], str(ref))
            self.assertNotEqual(changed[0]['identity'], expected)

    def test_default_voice_identity_and_invalid_reference_fail_before_model_load(self):
        default, calls = run_worker([{'id': 1, 'kind': 'warmup'}])
        self.assertEqual(default[0]['identity'], 'chatterbox-tts@0.1.7:builtin-default')
        self.assertEqual(calls['prepare'], [])
        invalid, calls = run_worker([{'id': 2, 'kind': 'warmup'}], '/nonexistent/noor-worker-reference.wav')
        self.assertIn('error', invalid[0])
        self.assertEqual(calls['loads'], 0)

    def test_failed_conditioning_never_marks_model_ready(self):
        with tempfile.TemporaryDirectory(prefix='noor-worker-test-') as folder:
            ref = Path(folder)/'reference.wav'
            ref.write_bytes(b'reference')
            responses, calls = run_worker([{'id': 1, 'kind': 'warmup'}, {'id': 2, 'kind': 'identity'}], str(ref), fail_prepare=True)
            self.assertTrue(all('error' in row and 'ready' not in row for row in responses))
            self.assertEqual(calls['loads'], 2)


if __name__ == '__main__':
    unittest.main()
