"""Build and smoke-test the CPU-only Kitten bundle on its target platform."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
from urllib.request import urlopen


PYTHON = "3.12.13"
MODEL_REVISION = "8e89ae2a718ee4bb893c67d67657e520e6112faf"
MODEL_URL = f"https://huggingface.co/KittenML/kitten-tts-2-mini/resolve/{MODEL_REVISION}"
MODEL_HASHES = {
    "kitten_tts_2_mini_int4.onnx": "1b81e037d2381934d1c3d13dd63b5cbf7243cf78273d4135b5aa7288ff93d2a8",
    "voices_es.npz": "3de943ddab5eeced04a42c732d39152802df01fd94f194181a7bc5bd60d52c3b",
}
CPU_DEPS = [
    "onnxruntime==1.23.2", "numpy==2.2.6",
    "huggingface_hub==2.4.0", "espeakng_loader==0.2.4", "phonemizer==3.6.0",
    "misaki==0.9.4", "num2words==0.5.14", "kitten-text-processing==0.1.0",
]


def sha256(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def build(output, worker, unpacked=False):
    system = {"Linux": "linux", "Darwin": "darwin", "Windows": "win32"}[platform.system()]
    architecture = {"x86_64": "x64", "amd64": "x64", "aarch64": "arm64", "arm64": "arm64"}[
        platform.machine().lower()
    ]
    output = output.resolve()
    archive = output / f"hive-kitten-{system}-{architecture}.tar.gz"
    if not unpacked:
        output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        env = {**os.environ, "HF_HUB_OFFLINE": "1"}
        uv = env.get("HIVE_KITTEN_UV", "uv")
        if unpacked:
            # Hive runs this command with the managed Python selected by uv.
            managed = Path(sys.executable).resolve()
        else:
            env["UV_PYTHON_INSTALL_DIR"] = str(root / "managed")
            subprocess.run([uv, "python", "install", PYTHON, "--no-bin", "--no-registry"], env=env, check=True)
            managed = Path(subprocess.check_output(
                [uv, "python", "find", "--managed-python", PYTHON], env=env, text=True
            ).strip())
        bundle = output if unpacked else root / "bundle"
        bundle.mkdir()
        python_root = managed.parent if system == "win32" else managed.parent.parent
        if unpacked:
            shutil.copytree(python_root, bundle / "python", symlinks=True)
        else:
            shutil.move(str(python_root), bundle / "python")
        python = bundle / "python" / ("python.exe" if system == "win32" else "bin/python3.12")
        install = [uv, "pip", "install", "--python", str(python), "--target", str(bundle / "deps")]
        subprocess.run([*install, *CPU_DEPS], env=env, check=True)
        subprocess.run([*install, "--no-deps", "kittenml==0.9.8"], env=env, check=True)
        shutil.copyfile(worker, bundle / "worker.py")

        model = bundle / "model"
        model.mkdir()
        for name in ("config.json", "vocab.json", "README.md", *MODEL_HASHES):
            target = model / name
            with urlopen(f"{MODEL_URL}/{name}", timeout=90) as response, target.open("wb") as destination:
                shutil.copyfileobj(response, destination)
            if name in MODEL_HASHES and sha256(target) != MODEL_HASHES[name]:
                raise RuntimeError(f"Unexpected checksum for {name}")
        config_file = model / "config.json"
        config = json.loads(config_file.read_text(encoding="utf-8"))
        spanish = config["languages"]["es"]
        spanish["model_file"] = spanish["model_files"]["int4"]
        config["languages"] = {"es": spanish}
        config["voices"] = {"es": config["voices"]["es"]}
        config["default_language"] = "es"
        config_file.write_text(json.dumps(config, ensure_ascii=False), encoding="utf-8")

        subprocess.run([python, "-I", "-B", bundle / "worker.py", "--smoke"], env=env, check=True)
        if unpacked:
            return
        with tarfile.open(archive, "w:gz", compresslevel=3) as tar:
            for path in sorted(bundle.iterdir()):
                tar.add(path, arcname=path.name)
    Path(f"{archive}.sha256").write_text(f"{sha256(archive)}  {archive.name}\n", encoding="ascii")
    print(archive)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--worker", type=Path)
    parser.add_argument("--unpacked", action="store_true")
    args = parser.parse_args()
    worker = args.worker or Path(__file__).resolve().with_name("worker.py")
    build(args.output, worker, args.unpacked)
