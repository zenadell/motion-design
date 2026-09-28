#!/usr/bin/env python3
"""Objective craft profile of a rendered film (MP4): rhythm, beat sync,
motion energy, frame fill, contrast swings. Used to compare generated films
against reference films and to set measurable targets.

usage: film-profile.py film.mp4 [--bpm 120] [--json]
"""
import json, subprocess, sys
import numpy as np

def frames(path, w=192, h=108, fps=60):
    ff = subprocess.check_output(['node', '-e', "console.log(require('ffmpeg-static'))"], cwd='/home/user/motion-design').decode().strip()
    raw = subprocess.run([ff, '-v', 'error', '-i', path, '-vf', f'scale={w}:{h},fps={fps}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout
    a = np.frombuffer(raw, np.uint8).reshape(-1, h, w, 3).astype(np.float32) / 255
    return a

def profile(path, bpm=120.0, fps=60):
    f = frames(path, fps=fps)
    lum = f @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    n = len(lum); dur = n / fps; beat = 60 / bpm
    diff = np.abs(np.diff(lum, axis=0)).mean(axis=(1, 2))            # motion per frame
    mean = lum.mean(axis=(1, 2))
    # frame fill: share of pixels differing from the frame's border median (the "background")
    border = np.concatenate([lum[:, 0, :], lum[:, -1, :], lum[:, :, 0], lum[:, :, -1]], axis=1)
    bg = np.median(border, axis=1)
    fill = (np.abs(lum - bg[:, None, None]) > 0.06).mean(axis=(1, 2))
    # cuts: big frame-to-frame changes (hard cuts, flashes, smash colour changes)
    thr = max(0.08, np.percentile(diff, 99) * 0.5)
    cut_idx = [i + 1 for i in range(len(diff)) if diff[i] > thr and (i == 0 or diff[i - 1] <= thr)]
    cuts = np.array(cut_idx) / fps
    # beat sync: share of cuts within ±1.5 frames of the 16th-note grid
    grid = beat / 4
    off = np.abs(((cuts + grid / 2) % grid) - grid / 2) if len(cuts) else np.array([])
    sync = float((off <= 1.5 / fps).mean()) if len(off) else 0.0
    # accents: local motion peaks (onsets) and their alignment to the 8th grid
    k = 3
    peaks = [i for i in range(k, len(diff) - k) if diff[i] == diff[i - k:i + k + 1].max() and diff[i] > np.median(diff) * 3 and diff[i] > 0.01]
    pt = np.array(peaks) / fps
    g8 = beat / 2
    poff = np.abs(((pt + g8 / 2) % g8) - g8 / 2) if len(pt) else np.array([])
    accent_sync = float((poff <= 2 / fps).mean()) if len(poff) else 0.0
    # stillness: longest stretch with almost no motion (excluding the last 1.5 s hold)
    live = diff[: max(1, int((dur - 1.5) * fps))]
    still = live < 0.002
    longest, run = 0, 0
    for s in still:
        run = run + 1 if s else 0
        longest = max(longest, run)
    # contrast swings: how often the frame flips between dark and light (mean luminance crosses 0.5)
    bright = mean > 0.5
    flips = int(np.sum(bright[1:] != bright[:-1]))
    per_beat = lambda x: float(x) / (dur / beat)
    return {
        'file': path.split('/')[-1], 'seconds': round(dur, 2),
        'cuts_per_beat': round(per_beat(len(cuts)), 3),
        'cut_beat_sync': round(sync, 3),
        'accents_per_beat': round(per_beat(len(peaks)), 3),
        'accent_8th_sync': round(accent_sync, 3),
        'motion_mean': round(float(diff.mean()) * 1000, 2),
        'motion_p90': round(float(np.percentile(diff, 90)) * 1000, 2),
        'longest_still_s': round(longest / fps, 2),
        'fill_mean': round(float(fill.mean()), 3),
        'fill_p10': round(float(np.percentile(fill, 10)), 3),
        'light_frames': round(float(bright.mean()), 3),
        'dark_light_flips_per_beat': round(per_beat(flips), 3),
        'luma_std_mean': round(float(lum.std(axis=(1, 2)).mean()), 3),
    }

if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    bpm = float(sys.argv[sys.argv.index('--bpm') + 1]) if '--bpm' in sys.argv else 120.0
    rows = [profile(p, bpm) for p in args if not p.replace('.', '').isdigit()]
    if '--json' in sys.argv:
        print(json.dumps(rows, indent=1))
    else:
        keys = list(rows[0].keys())
        w = max(len(k) for k in keys)
        for k in keys:
            print(k.ljust(w), *[str(r[k]).ljust(22) for r in rows])
