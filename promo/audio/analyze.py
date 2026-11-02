"""Measure a window of the track for the film.

  python3 audio/analyze.py <track.wav> <songStart> <seconds> [out-features.json]

Prints every onset in the window (film seconds, strength, and how much of
it is kick / snare / hat) so the cue sheet can be written against real
hits, and writes per-frame envelopes (kick, snare, hat, rms; 0..1 at 30fps)
that the film reads on every frame. Needs librosa.
"""
import sys, json
import numpy as np, librosa

track, start, dur = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
out = sys.argv[4] if len(sys.argv) > 4 else None
FPS = 30; HOP = 256
y, sr = librosa.load(track, sr=22050, mono=True, offset=max(0, start - 0.1), duration=dur + 0.3)
S = np.abs(librosa.stft(y, n_fft=1024, hop_length=HOP)); fr = librosa.fft_frequencies(sr=sr, n_fft=1024)
t = librosa.frames_to_time(np.arange(S.shape[1]), sr=sr, hop_length=HOP) - 0.1

def flux(lo, hi):
    b = S[(fr >= lo) & (fr < hi)].sum(0)
    return np.maximum(0, np.diff(np.log1p(b), prepend=0))

def envelope(x, decay):
    n = int(dur * FPS); v = np.zeros(n)
    for i in range(n):
        m = (t >= i / FPS) & (t < (i + 1) / FPS); v[i] = x[m].max() if m.any() else 0
    v = np.clip(v / np.percentile(v, 99.5), 0, 1); e = 0; env = np.zeros(n)
    for i in range(n): e = max(v[i], e * decay); env[i] = e
    return env

kick, snare, hat = envelope(flux(30, 140), .80), envelope(flux(180, 1200), .78), envelope(flux(5000, 11000), .60)
rms = librosa.feature.rms(y=y, frame_length=1024, hop_length=HOP)[0]
n = int(dur * FPS)
R = np.array([rms[(t >= i / FPS) & (t < (i + 1) / FPS)].mean() if ((t >= i / FPS) & (t < (i + 1) / FPS)).any() else 0 for i in range(n)]); R /= R.max()

on = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP)
peaks = librosa.util.peak_pick(on, pre_max=3, post_max=3, pre_avg=6, post_avg=6, delta=1.5, wait=4)
print("film_s  strength  kick snare hat")
for p in peaks:
    ft = t[p]
    if 0 <= ft <= dur:
        i = min(int(ft * FPS), n - 1)
        print(f"{ft:6.2f} {on[p]:6.1f}   {kick[i]:.2f} {snare[i]:.2f} {hat[i]:.2f}")
if out:
    json.dump({"fps": FPS, "songStart": start, "kick": np.round(kick, 3).tolist(), "snare": np.round(snare, 3).tolist(), "hat": np.round(hat, 3).tolist(), "rms": np.round(R, 3).tolist()}, open(out, "w"))
    print("wrote", out, n, "frames")
