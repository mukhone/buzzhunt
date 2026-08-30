"""Voiceover and mux helpers for BuzzHunt demo recordings.

The recorder creates one audio clip per narration beat, records Playwright video
while holding each beat for that clip's duration, then muxes the delayed clips
onto the raw browser capture.

Set XI_KEY in demo/.env or the project .env to use ElevenLabs. Without XI_KEY,
silent clips are generated with ffmpeg so the video pipeline still works.
"""
import json
import math
import os
import subprocess
import urllib.request
from pathlib import Path


HERE = Path(__file__).parent
ROOT = HERE.parent


def _read_env_file(path):
    cfg = {}
    if not path.exists():
        return cfg
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        cfg[key.strip()] = value.strip().strip('"').strip("'")
    return cfg


def load_env():
    cfg = {}
    cfg.update(_read_env_file(ROOT / ".env"))
    cfg.update(_read_env_file(HERE / ".env"))
    cfg.update({k: v for k, v in os.environ.items() if k.startswith(("XI_", "VOICE_", "MODEL_"))})
    return cfg


def probe_dur(path):
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
            str(path),
        ],
        capture_output=True,
        text=True,
    )
    try:
        return float(result.stdout.strip())
    except ValueError:
        return 4.0


def _estimate_duration(text):
    words = max(1, len(text.split()))
    return max(4.0, min(18.0, words / 2.45 + 1.1))


def _silent_mp3(path, duration):
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=44100:cl=mono",
            "-t",
            f"{duration:.2f}",
            "-q:a",
            "9",
            "-acodec",
            "libmp3lame",
            str(path),
        ],
        check=True,
        capture_output=True,
    )


def gen_vo(narration, out_dir, voice_id=None, model_id=None):
    """Generate or reuse one mp3 per narration beat.

    Returns an OrderedDict-compatible mapping of beat name to clip duration.
    """
    cfg = load_env()
    key = cfg.get("XI_KEY")
    voice = voice_id or cfg.get("VOICE_ID", "EXAVITQu4vr4xnSDxMaL")
    model = model_id or cfg.get("MODEL_ID", "eleven_multilingual_v2")
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    durations = {}

    for name, text in narration.items():
        mp3 = out_dir / f"{name}.mp3"
        if not mp3.exists():
            if key:
                body = json.dumps(
                    {
                        "text": text,
                        "model_id": model,
                        "voice_settings": {
                            "stability": 0.5,
                            "similarity_boost": 0.75,
                            "style": 0.0,
                            "use_speaker_boost": True,
                        },
                    }
                ).encode("utf-8")
                req = urllib.request.Request(
                    f"https://api.elevenlabs.io/v1/text-to-speech/{voice}",
                    data=body,
                    method="POST",
                    headers={
                        "xi-api-key": key,
                        "Content-Type": "application/json",
                        "Accept": "audio/mpeg",
                    },
                )
                with urllib.request.urlopen(req, timeout=90) as response:
                    mp3.write_bytes(response.read())
            else:
                _silent_mp3(mp3, _estimate_duration(text))

        durations[name] = probe_dur(mp3)
        print(f"  vo {name}: {durations[name]:.1f}s")

    return durations


def mux(raw_webm, marks, narr_keys, vo_dir, out_mp4, width):
    """Mux delayed narration clips onto the raw Playwright video."""
    vo_dir = Path(vo_dir)
    inputs = ["-i", str(raw_webm)]
    for name in narr_keys:
        inputs += ["-i", str(vo_dir / f"{name}.mp3")]

    parts = []
    labels = []
    for i, name in enumerate(narr_keys):
        delay_ms = int(math.floor(marks[name] * 1000))
        parts.append(f"[{i + 1}:a]adelay={delay_ms}:all=1[a{i}]")
        labels.append(f"[a{i}]")

    filter_complex = (
        f"[0:v]scale={width}:-2[v];"
        + ";".join(parts)
        + ";"
        + "".join(labels)
        + f"amix=inputs={len(narr_keys)}:normalize=0[mix]"
    )

    subprocess.run(
        [
            "ffmpeg",
            "-y",
            *inputs,
            "-filter_complex",
            filter_complex,
            "-map",
            "[v]",
            "-map",
            "[mix]",
            "-c:v",
            "libx264",
            "-crf",
            "21",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            str(out_mp4),
        ],
        check=True,
        capture_output=True,
    )
    print(f"SAVED: {out_mp4} ({probe_dur(out_mp4):.1f}s)")
