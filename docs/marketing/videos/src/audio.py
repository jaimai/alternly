"""Bande-son d'un Reel : musique originale de synthèse + bruitages calés sur l'animation.

Tout est généré ici (aucun échantillon externe) : pas de droits à gérer.
La partition se lit dans la page, bloc <script type="application/json" id="audio"> :
  {"bpm": 112, "prog": "warm", "drop": 3000, "duration": 15000, "cues": [[700, "pop"], …]}
- prog : grille d'accords (voir PROGS) ; drop : entrée de la batterie (ms) ;
- cues : [instant en ms, bruitage] (voir SFX), bruitage éventuellement suivi d'un gain.

usage : python3 audio.py page.html video.mp4   (remplace la piste son de la vidéo)
Requiert numpy et ffmpeg (variable FFMPEG, sinon « ffmpeg »).
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import wave

import numpy as np

SR = 44100
rng = np.random.default_rng(7)

# Grilles de 4 accords (notes MIDI), une mesure par accord.
PROGS = {
    "warm": [[48, 55, 64, 67], [43, 55, 62, 71], [45, 57, 60, 64], [41, 57, 60, 65]],    # C G Am F
    "soft": [[45, 57, 60, 64], [41, 57, 60, 65], [48, 55, 64, 67], [43, 55, 62, 71]],    # Am F C G
    "bright": [[41, 57, 60, 65], [43, 55, 62, 67], [45, 57, 60, 64], [48, 55, 64, 67]],  # F G Am C
}


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def env(n, a=0.005, r=0.2):
    t = np.arange(n) / SR
    return np.minimum(1, t / max(a, 1e-4)) * np.exp(-t / r)


def band(x, lo, hi):
    f = np.fft.rfft(x)
    fr = np.fft.rfftfreq(len(x), 1 / SR)
    f[(fr < lo) | (fr > hi)] = 0
    return np.fft.irfft(f, len(x))


def add(buf, sig, t):
    i = int(t * SR)
    if i >= len(buf):
        return
    sig = sig[: len(buf) - i]
    buf[i:i + len(sig)] += sig


# ---------- instruments ----------
def pad(notes, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for m in notes[1:]:
        for det in (-0.08, 0.08):
            f = hz(m + det)
            out += sum(np.sin(2 * np.pi * f * k * t) / k ** 2 for k in (1, 2, 3))
    a = np.minimum(1, t / 0.25) * np.minimum(1, (dur - t) / 0.25)
    return out * a * 0.05


def pluck(m, dur=0.5, vol=0.16):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = hz(m)
    s = sum(np.sin(2 * np.pi * f * k * t) * np.exp(-t * (5 + 7 * k)) / k ** 1.3 for k in range(1, 7))
    return s * np.minimum(1, t / 0.003) * vol


def bass(m, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = hz(m - 12)
    s = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t)
    return s * np.minimum(1, t / 0.01) * np.exp(-t / 0.6) * 0.18


def kick():
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    ph = 2 * np.pi * np.cumsum(45 + 110 * np.exp(-t * 30)) / SR
    return np.sin(ph) * np.exp(-t * 9) * 0.36


def snap():
    n = int(0.18 * SR)
    return band(rng.standard_normal(n), 1200, 6000) * env(n, 0.001, 0.045) * 0.22


def hat(open_=False):
    n = int((0.12 if open_ else 0.05) * SR)
    return band(rng.standard_normal(n), 7000, 16000) * env(n, 0.001, 0.05 if open_ else 0.015) * 0.09


# ---------- bruitages ----------
def sfx_pop():
    n = int(0.09 * SR)
    t = np.arange(n) / SR
    ph = 2 * np.pi * np.cumsum(900 * np.exp(-t * 25) + 380) / SR
    return np.sin(ph) * env(n, 0.002, 0.03) * 0.35


def sfx_tap():
    n = int(0.05 * SR)
    t = np.arange(n) / SR
    return (np.sin(2 * np.pi * 1800 * t) * 0.5 + band(rng.standard_normal(n), 2000, 8000)) * env(n, 0.0005, 0.008) * 0.35


def sfx_tick():
    n = int(0.03 * SR)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * 2600 * t) * env(n, 0.0005, 0.006) * 0.18


def sfx_whoosh():
    n = int(0.55 * SR)
    t = np.arange(n) / SR
    x = rng.standard_normal(n)
    out = np.zeros(n)
    seg = n // 8
    for i in range(8):  # balayage du filtre vers l'aigu
        c = 500 * 2 ** (i * 0.55)
        part = band(x, c * 0.6, c * 1.8)[i * seg:(i + 1) * seg]
        out[i * seg:i * seg + len(part)] = part
    shape = np.sin(np.pi * t / (n / SR)) ** 2
    return out * shape * 0.28


def sfx_ding():
    n = int(1.2 * SR)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for f, d, a in ((1318.5, 0, 0.5), (1975.5, 0.11, 0.45)):
        i = int(d * SR)
        tt = t[: n - i]
        s[i:] += (np.sin(2 * np.pi * f * tt) + 0.2 * np.sin(2 * np.pi * f * 2.76 * tt)) * np.exp(-tt * 4) * a
    return s * 0.3


def sfx_success():
    out = np.zeros(int(0.9 * SR))
    for i, m in enumerate((72, 76, 79, 84)):
        add(out, pluck(m, 0.6, 0.22), i * 0.07)
    return out


def sfx_coin():
    out = np.zeros(int(0.6 * SR))
    for i, f in enumerate((1568, 2093)):
        n = int(0.4 * SR)
        t = np.arange(n) / SR
        sq = np.sign(np.sin(2 * np.pi * f * t)) * 0.3 + np.sin(2 * np.pi * f * t)
        add(out, sq * env(n, 0.001, 0.12 if i else 0.04) * 0.12, i * 0.075)
    return out


def sfx_riser():
    n = int(1.6 * SR)
    t = np.arange(n) / SR
    ph = 2 * np.pi * np.cumsum(300 * 2 ** (t * 1.6)) / SR
    noise = band(rng.standard_normal(n), 3000, 12000) * 0.3
    return (np.sin(ph) * 0.15 + noise) * (t / t[-1]) ** 2 * 0.3


def sfx_paper():
    n = int(0.22 * SR)
    return band(rng.standard_normal(n), 1500, 9000) * env(n, 0.01, 0.06) * 0.22


SFX = {"pop": sfx_pop, "tap": sfx_tap, "tick": sfx_tick, "whoosh": sfx_whoosh, "ding": sfx_ding,
       "success": sfx_success, "coin": sfx_coin, "riser": sfx_riser, "paper": sfx_paper}


def music(spec, dur):
    bpm = spec.get("bpm", 112)
    beat = 60 / bpm
    bar = 4 * beat
    prog = PROGS[spec.get("prog", "warm")]
    drop = spec.get("drop", 3000) / 1000
    end = spec.get("outro", spec["duration"] - 1200) / 1000  # batterie coupée pour le CTA
    buf = np.zeros(int(dur * SR) + SR)
    nbars = int(dur / bar) + 1
    for b in range(nbars):
        ch = prog[b % len(prog)]
        t0 = b * bar
        add(buf, pad(ch, bar + 0.3), t0)
        add(buf, bass(ch[0], bar * 0.9), t0)
        arp = [ch[1] + 12, ch[2] + 12, ch[3] + 12, ch[2] + 12]
        for i in range(8):  # croches
            t = t0 + i * beat / 2
            if t >= dur:
                break
            vol = 0.11 if t < drop else 0.15
            add(buf, pluck(arp[i % 4], 0.45, vol), t)
            if drop <= t < end:
                if i % 4 == 0:
                    add(buf, kick(), t)
                if i % 4 == 2:
                    add(buf, snap(), t)
                add(buf, hat(i % 2 == 1 and i % 4 == 3), t + (0 if i % 2 == 0 else 0.012))
    # dernier accord tenu sous le CTA, puis fondu
    n = len(buf)
    t = np.arange(n) / SR
    fade = np.clip((dur - t) / 0.9, 0, 1)
    return buf * fade


def render(spec):
    dur = spec["duration"] / 1000
    mus = music(spec, dur)
    fx = np.zeros_like(mus)
    for cue in spec.get("cues", []):
        t, name = cue[0] / 1000, cue[1]
        gain = cue[2] if len(cue) > 2 else 1.0
        add(fx, SFX[name]() * gain, t)
    mix = mus * spec.get("music_gain", 0.8) + fx
    mix = np.tanh(mix * 1.4) / 1.4  # légère saturation douce, évite l'écrêtage
    mix = mix[: int(dur * SR)]
    mix = mix / (np.abs(mix).max() + 1e-9) * 0.89
    # léger élargissement stéréo : retard de 9 ms à droite sur la musique
    d = int(0.009 * SR)
    right = mix.copy()
    right[d:] = mix[:-d] * 0.6 + mix[d:] * 0.4
    return np.stack([mix, right], 1)


def main():
    page, video = sys.argv[1], sys.argv[2]
    html = open(page, encoding="utf-8").read()
    spec = json.loads(re.search(r'<script type="application/json" id="audio">(.*?)</script>', html, re.S).group(1))
    st = render(spec)
    ff = os.environ.get("FFMPEG", "ffmpeg")
    with tempfile.TemporaryDirectory() as d:
        wav = os.path.join(d, "a.wav")
        with wave.open(wav, "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes((st * 32767).astype("<i2").tobytes())
        out = os.path.join(d, "out.mp4")
        subprocess.run([ff, "-y", "-loglevel", "error", "-i", video, "-i", wav, "-map", "0:v", "-map", "1:a",
                        "-c:v", "copy", "-af", "loudnorm=I=-14:TP=-1.5:LRA=9", "-c:a", "aac", "-b:a", "192k",
                        "-ar", "44100", "-shortest", "-movflags", "+faststart", out], check=True)
        os.replace(out, video)
    print("ok", video)


if __name__ == "__main__":
    main()
