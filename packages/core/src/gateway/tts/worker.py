import hmac
import io
import json
import os
from pathlib import Path
import sys
import threading
import traceback
import wave
from http.server import BaseHTTPRequestHandler, HTTPServer


def main():
    root = Path(__file__).resolve().parent
    sys.path.insert(0, str(root / "deps"))
    import numpy as np
    from kittenml import KittenTTS

    model = KittenTTS(str(root / "model"), device="cpu")
    voices = {voice["name"].lower(): voice["name"] for voice in model.voices("es")}
    model.generate("Hola.", voice=voices["lucia"], language="es")
    if "--smoke" in sys.argv:
        print(json.dumps(list(voices)), flush=True)
        return

    token = os.environ["HIVE_KITTEN_TOKEN"]

    class SpeechHandler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            pass

        def do_POST(self):
            if self.path != "/tts" or not hmac.compare_digest(self.headers.get("Authorization", ""), token):
                self.send_error(404)
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 65536:
                    raise ValueError("Invalid body size")
                data = json.loads(self.rfile.read(size))
                text = data["text"].strip()
                voice = voices[data["voice"]]
                if not text:
                    raise ValueError("Empty text")
            except (KeyError, ValueError, TypeError, AttributeError):
                self.send_error(400)
                return

            try:
                audio = model.generate(text, voice=voice, language="es")
                samples = np.clip(audio * 32768, -32768, 32767).astype("<i2")
                output = io.BytesIO()
                with wave.open(output, "wb") as wav:
                    wav.setparams((1, 2, model.sample_rate, 0, "NONE", "not compressed"))
                    wav.writeframes(samples.tobytes())
                body = output.getvalue()
                self.send_response(200)
                self.send_header("Content-Type", "audio/wav")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                return
            except Exception:
                traceback.print_exc()
                self.send_error(500)

    with HTTPServer(("127.0.0.1", 0), SpeechHandler) as server:
        def watch_parent():
            sys.stdin.buffer.read(1)
            os._exit(0)

        threading.Thread(target=watch_parent, daemon=True).start()
        print(json.dumps({"port": server.server_port, "voices": voices}), flush=True)
        sys.stdout = sys.stderr
        server.serve_forever()


if __name__ == "__main__":
    main()
