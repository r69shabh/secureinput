"""Synthesize the launch video soundtrack -> public/music.wav.

Original, procedurally generated (no samples), so it is free to use anywhere.
Timings mirror the scene table in src/Launch.tsx (30 fps).
Run: python3 -I scripts/compose.py
"""
import os
import wave

import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt

SR = 44100
LENGTH = 29.0
N = int(SR * LENGTH)
rng = np.random.default_rng(7)

mix = np.zeros((2, N))  # stereo
rev_send = np.zeros((2, N))


def fr(frames):  # video frame -> seconds
    return frames / 30.0


def hz(note):
    names = {"C": 0, "C#": 1, "Db": 1, "D": 2, "Eb": 3, "E": 4, "F": 5, "F#": 6,
             "G": 7, "Ab": 8, "A": 9, "Bb": 10, "B": 11}
    name, octave = note[:-1], int(note[-1])
    return 440.0 * 2 ** ((names[name] + 12 * (octave + 1) - 69) / 12)


def lp(x, cutoff, order=2):
    return sosfilt(butter(order, cutoff, "low", fs=SR, output="sos"), x)


def hp(x, cutoff, order=2):
    return sosfilt(butter(order, cutoff, "high", fs=SR, output="sos"), x)


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], "band", fs=SR, output="sos"), x)


def place(sig, at, gain=1.0, pan=0.0, send=0.0):
    i = int(at * SR)
    if i >= N:
        return
    sig = sig[: N - i] * gain
    l, r = np.sqrt((1 - pan) / 2), np.sqrt((1 + pan) / 2)
    mix[0, i : i + len(sig)] += sig * l
    mix[1, i : i + len(sig)] += sig * r
    if send:
        rev_send[0, i : i + len(sig)] += sig * l * send
        rev_send[1, i : i + len(sig)] += sig * r * send


def t_axis(dur):
    return np.arange(int(dur * SR)) / SR


# ---------- instruments ----------
def kick(dur=0.5, punch=1.0):
    t = t_axis(dur)
    f = 44 + 70 * np.exp(-t * 28)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7)
    click = lp(rng.standard_normal(len(t)), 3000) * np.exp(-t * 300) * 0.25
    return np.tanh((body + click) * 1.6 * punch) * 0.8


def rim(dur=0.12):
    t = t_axis(dur)
    tone = np.sin(2 * np.pi * 1750 * t) * np.exp(-t * 90) * 0.35
    noise = bp(rng.standard_normal(len(t)), 1500, 5000) * np.exp(-t * 60)
    return (tone + noise) * 0.5


def snare(dur=0.3):
    t = t_axis(dur)
    noise = bp(rng.standard_normal(len(t)), 900, 7000) * np.exp(-t * 18)
    body = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30) * 0.5
    return lp(noise + body, 6000) * 0.45


def hat(dur=0.05, open_=False):
    t = t_axis(0.25 if open_ else dur)
    return hp(rng.standard_normal(len(t)), 7000) * np.exp(-t * (14 if open_ else 90)) * 0.22


def key_click():
    t = t_axis(0.025)
    return hp(rng.standard_normal(len(t)), 2500) * np.exp(-t * 260) * 0.25


def epiano(note, dur=1.6, vel=1.0):
    f = hz(note) if isinstance(note, str) else note
    t = t_axis(dur + 0.6)
    env = np.minimum(t / 0.004, 1) * np.exp(-t * 2.2)
    env *= np.clip((dur + 0.6 - t) / 0.6, 0, 1)
    tone = (np.sin(2 * np.pi * f * t)
            + 0.28 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t * 5)
            + 0.12 * np.sin(2 * np.pi * 4.01 * f * t) * np.exp(-t * 14))
    trem = 1 + 0.12 * np.sin(2 * np.pi * 4.6 * t)
    return lp(tone * env * trem, 3800) * 0.16 * vel


def chord(notes, at, dur=1.8, vel=1.0, send=0.35):
    for k, n in enumerate(notes):
        pan = (k / max(1, len(notes) - 1) - 0.5) * 0.6
        place(epiano(n, dur, vel), at + k * 0.008, pan=pan, send=send)


def bass(note, dur):
    f = hz(note)
    t = t_axis(dur + 0.08)
    env = np.minimum(t / 0.01, 1) * np.clip((dur + 0.08 - t) / 0.08, 0, 1) * np.exp(-t * 0.8)
    tone = np.tanh(2.2 * (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * 2 * f * t)))
    return lp(tone * env, 420) * 0.42


def pad(notes, dur, gain=0.06):
    t = t_axis(dur)
    sig = np.zeros(len(t))
    for n in notes:
        f = hz(n)
        for det in (-0.12, 0.0, 0.11):
            ph = rng.uniform(0, 1)
            sig += 2 * ((t * f * 2 ** (det / 12) + ph) % 1) - 1
    env = np.minimum(t / 1.2, 1) * np.clip((dur - t) / 1.0, 0, 1)
    return lp(sig, 900, 4) * env * gain


def bell(note, vel=1.0):
    f = hz(note)
    t = t_axis(1.8)
    tone = np.sin(2 * np.pi * f * t + 1.2 * np.sin(2 * np.pi * f * 3.5 * t) * np.exp(-t * 6))
    return tone * np.exp(-t * 3.2) * 0.09 * vel


def whoosh(dur=0.55):
    t = t_axis(dur)
    noise = rng.standard_normal(len(t))
    out = np.zeros(len(t))
    # crude sweep: crossfade a few band-passed layers rising in pitch
    bands = [(300, 900), (700, 2000), (1500, 4500), (3000, 8000)]
    for k, (lo, hi) in enumerate(bands):
        w = np.clip(1 - np.abs(t / dur * (len(bands) - 1) - k), 0, 1)
        out += bp(noise, lo, hi) * w
    env = (t / dur) ** 2.2 * np.clip((dur - t) / 0.04, 0, 1)
    return out * env * 0.12


def stab_dissonant():
    t = t_axis(1.4)
    sig = sum(np.sin(2 * np.pi * hz(n) * t) for n in ("D2", "Eb3", "Ab3", "D4"))
    sig += 0.5 * bp(rng.standard_normal(len(t)), 200, 3000) * np.exp(-t * 20)
    return np.tanh(sig * 0.9) * np.exp(-t * 2.6) * 0.22


# ---------- arrangement ----------
BEAT = 0.5          # 120 bpm
BAR = 4 * BEAT
GROOVE = fr(120)    # headline hit
END = fr(774)       # end card
FEAT = fr(558)

# 0-4s: tense intro - low drone, clock ticks, typing
place(pad(["D2", "A2"], GROOVE + 0.6, gain=0.05), 0.0, send=0.2)
for k in range(8):
    place(rim(), k * BEAT, gain=0.25 if k % 2 else 0.4, pan=-0.3)
for frame in range(6, 30, 2):                       # agent typing
    place(key_click(), fr(frame), gain=0.5, pan=rng.uniform(-0.4, 0.4))
for frame in range(34, 56):                         # user pasting the key
    place(key_click(), fr(frame), gain=0.7, pan=rng.uniform(-0.4, 0.4))
place(stab_dissonant(), fr(70), send=0.5)           # caught!
place(whoosh(0.9), GROOVE - 0.9, gain=1.2)

# groove: 4.0s -> end card
PROG = [
    (["D3", "F3", "A3", "C4", "E4"], "D2"),   # Dm9
    (["Bb2", "D3", "F3", "A3", "C4"], "Bb1"),  # Bbmaj9
    (["G2", "Bb2", "D3", "F3", "A3"], "G1"),   # Gm9
    (["A2", "D3", "E3", "G3", "C4"], "A1"),    # A7sus
]
bar_i = 0
t0 = GROOVE
while t0 < END - 0.01:
    notes, root = PROG[bar_i % 4]
    busy = t0 >= FEAT - 0.01
    chord(notes, t0, dur=1.2, vel=0.9)
    chord(notes[1:4], t0 + 2.5 * BEAT, dur=0.35, vel=0.55)
    place(bass(root, 1.4 * BEAT), t0)
    place(bass(root, 0.4 * BEAT), t0 + 1.5 * BEAT, gain=0.8)
    place(bass(root, 1.2 * BEAT), t0 + 2.5 * BEAT, gain=0.9)
    place(kick(), t0)
    place(kick(), t0 + 1.5 * BEAT, gain=0.7)
    if busy:
        place(kick(), t0 + 2.5 * BEAT, gain=0.6)
    place(snare(), t0 + 2 * BEAT, gain=0.9, send=0.25)
    place(rim(), t0 + 3.5 * BEAT, gain=0.35, pan=0.3)
    for k in range(8 if busy else 4):
        step = BEAT / 2 if busy else BEAT
        place(hat(), t0 + k * step, gain=(0.9 if k % 2 else 0.6), pan=0.35)
    if bar_i % 4 == 3:
        place(hat(open_=True), t0 + 3.5 * BEAT, gain=0.6, pan=0.35)
    place(pad([notes[0], notes[2]], BAR + 0.4, gain=0.035), t0, send=0.3)
    t0 += BAR
    bar_i += 1

# impact on the headline + transitions
place(kick(0.9, punch=1.4), GROOVE, gain=0.9)
for cut in (216, 312, 558, 708):
    place(whoosh(), fr(cut) - 0.55, gain=0.8)

# demo sound design
place(key_click(), fr(312 + 100), gain=1.2)          # Enter
place(bell("A5"), fr(312 + 100), send=0.5)
place(bell("D6"), fr(312 + 128), send=0.5, pan=0.3)  # reaches daemon
place(bell("F6"), fr(312 + 156), send=0.5, pan=0.4)  # reaches command
place(bell("A6", 0.7), fr(312 + 168), send=0.6)      # result

# features: one ascending note per line
for k, n in enumerate(["D5", "F5", "G5", "A5", "C6"]):
    place(bell(n, 0.8), FEAT + k * fr(28), send=0.45, pan=-0.2 + k * 0.1)

# hosts: soft pops
for k in range(6):
    place(epiano(hz("D6") * 2 ** ((k * 2) / 12), 0.15, 0.5), fr(708 + 6 + k * 4), pan=-0.5 + k * 0.2)

# end card: resolve
place(whoosh(0.7), END - 0.7, gain=1.0)
place(kick(1.2, punch=1.3), END, gain=0.9)
place(bass("D2", 2.6), END)
chord(["D3", "F3", "A3", "C4", "E4", "G4"], END, dur=2.6, vel=1.1, send=0.6)
place(pad(["D3", "A3", "E4"], LENGTH - END, gain=0.05), END, send=0.4)
place(bell("E6", 0.8), END + fr(32), send=0.7)

# ---------- reverb + master ----------
ir_t = t_axis(2.2)
for ch in range(2):
    ir = rng.standard_normal(len(ir_t)) * np.exp(-ir_t * 3.0)
    ir = lp(ir, 5000)
    wet = fftconvolve(rev_send[ch], ir)[:N]
    mix[ch] += wet / np.max(np.abs(ir)) * 0.012

mix = hp(mix, 30)
mix = np.tanh(mix * 1.3) / np.tanh(1.3)            # gentle tape-ish glue
fade_in = np.minimum(np.arange(N) / (0.05 * SR), 1)
fade_out = np.clip((LENGTH - np.arange(N) / SR) / 1.2, 0, 1)
mix *= fade_in * fade_out
mix *= 0.89 / np.max(np.abs(mix))

out = os.path.join(os.path.dirname(__file__), "..", "public", "music.wav")
pcm = (mix.T * 32767).astype(np.int16)
with wave.open(out, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print("wrote", os.path.abspath(out))
