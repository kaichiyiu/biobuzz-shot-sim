#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Oracle extension for the fork features (mouth frame, rectangular window, hood). Imports oracle.py, never edits it.

  python tests/crosscheck/oracle_ext.py --batch <cases.json> <out.json>     (list of cases -> list of results)
  python tests/crosscheck/oracle_ext.py --selftest-ext                      (also runs oracle_ext_hood's self-test)

Shot case (kind "shot", the default) - engine frame: inches, m/s, degrees, field-centre origin, yaw = absolute heading from +x:
  {"id": any, "mouth": {"x","y","height"}, "ball": "pollen"|"nectar", "target": "red"|"blue",
   "hive_state": {"red": -1|1, "blue": -1|1} (default: match start), "spin": "back" (default) | "top" (single wheel, S0 -> -|S0|; see oracle_ext_spin.py),
   "S0": launch spin ratio (default 1.0 = single wheel), "theta": deg, "v": m/s, "yaw": deg}
  or "shots": [{"theta","v","yaw"}, ...] (one mouth set-up, many shots -> a list of results)
  The mouth is clamped like the engine (SPEC 4/8): x, y to +-(field.half - r_ball), height to 4..29 in.
Result: {"hit", "rect_hit", "entry_angle_deg", "entry_speed", "cause", "entry_w", "entry_B", "mouth": clamped mouth}
  hit = pentagon test (oracle.py); rect_hit = hit and the ball centre at the mouth-plane crossing has |w| <= W2 - r and
  r <= B <= SH - r (B = b - b0, height above the lip in the opening's plane; W2 = width/2, SH = shoulder, data/field.json);
  entry_angle_deg = atan2(vz, vr) of the velocity at the crossing (< 0 = descending), entry_speed = |v| there (m/s);
  entry_* are null for misses. Optional "entry_rules": [rule] adds "entry_pass": [bool] (oracle_ext_entry.py). Hood case (kind "hood"): see oracle_ext_hood.py.
"""
import argparse
import json
import math
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import oracle as O  # noqa: E402
from oracle_ext_spin import s0_of  # noqa: E402  (also installs the symmetric lift clamp into oracle.py's flight)
from oracle_ext_entry import rule_pass  # noqa: E402

H_RANGE = (4.0, 29.0)


def prep(case, field):
    """Clamp the mouth and normalise one case -> oracle.py case skeleton (no shots)."""
    ball = str(case.get('ball', 'pollen')).lower()
    L = float(field['field']['half']) - O.BALLS[ball]['D_in'] / 2.0
    m = case.get('mouth') or {}
    x = min(L, max(-L, float(m.get('x', -12.75))))
    y = min(L, max(-L, float(m.get('y', -48.0))))
    h = min(H_RANGE[1], max(H_RANGE[0], float(m.get('height', 16.0))))
    oc = {'id': case.get('id'), 'ballId': ball, 'target': case.get('target', 'red'), 'robot': {'x': x, 'y': y},
          'h0': h, 'S0': s0_of(case), 'mouth': {'x': x, 'y': y, 'height': h}}
    if case.get('hive_state'):
        oc['hiveState'] = case['hive_state']
    return oc


def _shots_of(case):
    if 'shots' in case:
        return [{'thetaDeg': s['theta'], 'v': s['v'], 'yawDeg': s['yaw']} for s in case['shots']]
    return [{'thetaDeg': case['theta'], 'v': case['v'], 'yawDeg': case['yaw']}]


def entry_velocity(S, R, idx, dt=O.DT):
    """(angle deg, speed m/s) of the velocity at the mouth-plane crossing of the hit shots idx: re-fly with oracle.rk4_step."""
    t = R['tCross'][idx]
    n = np.floor(t / dt + 1e-9).astype(int)
    rem = t - n * dt
    q = {k: S[k][idx] for k in ('kd', 'klc', 'wr')}
    vr, vz = S['v0'][idx] * np.cos(S['theta'][idx]), S['v0'][idx] * np.sin(S['theta'][idx])
    rho, z = np.zeros(len(idx)), np.zeros(len(idx))
    for k in range(int(n.max()) if len(n) else 0):
        act = k < n
        nxt = O.rk4_step(rho, z, vr, vz, q['kd'], q['klc'], q['wr'], dt)
        rho, z, vr, vz = [np.where(act, a, b) for a, b in zip(nxt, (rho, z, vr, vz))]
    rho, z, vr, vz = O.rk4_step(rho, z, vr, vz, q['kd'], q['klc'], q['wr'], rem)
    return np.degrees(np.arctan2(vz, vr)), np.hypot(vr, vz)


def classify_batch(cases, field=None, chunk=20000, dt=O.DT):
    """Results for a list of shot cases (see module doc): a dict for a single-shot case, a list for a 'shots' case."""
    field = field or O.load_field()
    geom = O.Geometry(field)
    cell = field['hive']['cell']
    W2, SH = float(cell['width']) / 2.0, float(cell['shoulder'])
    pieces = []                                   # (case index, first shot index, oracle case)
    for ci, c in enumerate(cases):
        oc, shots = prep(c, field), _shots_of(c)
        for o in range(0, len(shots), chunk):
            pieces.append((ci, o, dict(oc, shots=shots[o:o + chunk])))
    out = [[None] * len(_shots_of(c)) for c in cases]
    i = 0
    while i < len(pieces):
        j, cnt = i, 0
        while j < len(pieces) and (cnt == 0 or cnt + len(pieces[j][2]['shots']) <= chunk):
            cnt += len(pieces[j][2]['shots'])
            j += 1
        batch = pieces[i:j]
        S, where = O.build_shot_arrays(geom, [p[2] for p in batch], range(len(batch)))
        R = O.simulate(geom, S, dt=dt)
        hit = R['hit']
        B = R['entryB'] - geom.b0
        rect = hit & (np.abs(R['entryW']) <= W2 - S['r'] + 1e-12) & (B >= S['r'] - 1e-12) & (B <= SH - S['r'] + 1e-12)
        idx = np.nonzero(hit)[0]
        ang = np.full(len(hit), np.nan)
        spd = np.full(len(hit), np.nan)
        if len(idx):
            ang[idx], spd[idx] = entry_velocity(S, R, idx, dt)
        for n, (bi, si) in enumerate(where):
            ci, off, oc = batch[bi]
            h = bool(hit[n])
            out[ci][off + si] = {
                'hit': h, 'rect_hit': bool(rect[n]), 'cause': None if h else O.CAUSES[int(R['cause'][n])],
                'entry_angle_deg': float(ang[n]) if h else None, 'entry_speed': float(spd[n]) if h else None,
                'entry_pass': [rule_pass(r, bool(rect[n]), ang[n], spd[n]) for r in cases[ci].get('entry_rules', [])],
                'entry_w': float(R['entryW'][n]) if h else None, 'entry_B': float(B[n]) if h else None, 'mouth': oc['mouth']}
        i = j
    return [r if 'shots' in c else r[0] for c, r in zip(cases, out)]


def classify_ext(case, field=None):
    """Single shot case -> {hit, rect_hit, entry_angle_deg, entry_speed, ...}."""
    return classify_batch([case], field)[0]


def run_batch(cases, field=None):
    from oracle_ext_hood import hood_ext          # lazy: oracle_ext_hood imports this module
    field = field or O.load_field()
    res = [None] * len(cases)
    shot_ix = [i for i, c in enumerate(cases) if c.get('kind', 'shot') == 'shot']
    for i, r in zip(shot_ix, classify_batch([cases[i] for i in shot_ix], field)):
        res[i] = r
    for i, c in enumerate(cases):
        if c.get('kind') == 'hood':
            res[i] = hood_ext(c, c['hood'], c.get('axes'), field)
    return res


def selftest():
    field = O.load_field()
    ok = [0, 0]

    def chk(name, cond):
        ok[0 if cond else 1] += 1
        print(('  ok   ' if cond else '  FAIL ') + name)
    base = {'mouth': {'x': -12.75, 'y': -48, 'height': 16}, 'target': 'red', 'yaw': 90.0}
    grid = [dict(base, theta=th, v=v) for th in (55, 60, 65, 70) for v in np.arange(5.0, 10.01, 0.1)]
    res = classify_batch(grid, field)
    k = next((i for i, r in enumerate(res) if r['rect_hit']), None)
    chk('1 on-axis shot scores and is a rect hit', k is not None)
    g = grid[k]
    r0 = res[k]
    chk('2 centre shot: |w| inside the rect, B between r and SH - r', abs(r0['entry_w']) < 10 - 1.4 and 1.4 <= r0['entry_B'] <= 7.61 - 1.4)
    k3 = next((i for i, r in enumerate(res) if r['rect_hit'] and r['entry_angle_deg'] < 0), None)
    chk('3 a faster centre shot crosses descending; entry speed in (0, launch speed)', k3 is not None and 0 < res[k3]['entry_speed'] < grid[k3]['v'])
    kk = next((i for i, r in enumerate(res) if r['hit'] and not r['rect_hit']), None)
    chk('4 crossing above SH - r (near the roof peak) scores on the pentagon but is not a rect hit', kk is not None and res[kk]['entry_B'] > 7.61 - 1.4)
    chk('5 rect_hit implies hit for every grid shot', all(r['hit'] or not r['rect_hit'] for r in res))
    ps = prep({'mouth': {'x': -200, 'y': 300, 'height': 99}}, field)['mouth']
    chk('6 mouth clamps to +-(70.5 - 1.4) and height 29', ps == {'x': -69.1, 'y': 69.1, 'height': 29.0})
    pn = prep({'ball': 'nectar', 'mouth': {'x': 80, 'y': 0, 'height': 1}}, field)['mouth']
    chk('7 nectar clamp uses its own radius, height floor 4', abs(pn['x'] - (70.5 - 91.948 / 25.4 / 2)) < 1e-9 and pn['height'] == 4.0)
    a = classify_ext(dict(g, mouth={'x': -300, 'y': -48, 'height': 16}), field)
    b = classify_ext(dict(g, mouth={'x': -69.1, 'y': -48, 'height': 16}), field)
    chk('8 clamped mouth gives the same result as the explicit clamped mouth', a['hit'] == b['hit'] and a['cause'] == b['cause'])
    chk('9 a flat shot straight into the floor misses with a cause', classify_ext(dict(base, theta=1, v=3), field)['cause'] in ('short', 'floor'))
    top = classify_batch([dict(base, theta=th, v=v, spin='top') for th in (55, 60, 65, 70) for v in np.arange(5.0, 10.01, 0.1)], field)
    chk('10 spin top: runs, differs from back (sign of the lift), rect_hit implies hit', any(t['hit'] != r['hit'] for t, r in zip(top, res)) and all(t['hit'] or not t['rect_hit'] for t in top))
    az = [float(O.accel(np.array([2.0]), np.array([0.0]), 0.0, 1.0, np.array([w]))[1][0]) for w in (-5.0, -2.0, 5.0, 2.0)]
    chk('12 lift clamp is symmetric: w r = -5 at |v| = 2 lifts like -2 (oracle.py alone: -5), +5 like +2', az[0] == az[1] == -4.0 - O.G and az[2] == az[3] == 4.0 - O.G)
    chk('13 entry rules need a rect hit: any / descending / maxSpeed', [rule_pass(r, True, -5.0, 3.0) for r in ({'rule': 'any'}, {'rule': 'descending'}, {'rule': 'maxSpeed', 'maxSpeedMps': 2.0})] == [True, True, False] and not rule_pass({'rule': 'any'}, False, -5.0, 3.0))
    from oracle_ext_hood import selftest as hood_selftest, centre_aim
    Hr = np.zeros((1, 40, 9), bool)                 # diagonal ridge: the centre aim must walk along it and stop at a fixed point
    for k in range(9):
        Hr[0, 5 + k:12 + k, k] = True
    r1 = centre_aim(Hr, list(np.linspace(1, 2, 40)), 0, 8, 0, 39)
    chk('11 centre aim walks a ridge and ends at a fixed point (regression: it once never advanced)', r1 != (8, 0) and centre_aim(Hr, list(np.linspace(1, 2, 40)), 0, r1[0], r1[1], 39) == r1)
    h_ok = hood_selftest(field)
    print('oracle_ext selftest: %d passed, %d failed; hood %s' % (ok[0], ok[1], 'ok' if h_ok else 'FAILED'))
    return ok[1] == 0 and h_ok


def main(argv=None):
    ap = argparse.ArgumentParser(description='Oracle extension: mouth, rect window, hood.')
    ap.add_argument('--batch', nargs=2, metavar=('CASES', 'OUT'))
    ap.add_argument('--selftest-ext', action='store_true')
    args = ap.parse_args(argv)
    if args.selftest_ext:
        return 0 if selftest() else 1
    if not args.batch:
        ap.error('need --batch <cases.json> <out.json> or --selftest-ext')
    with open(args.batch[0], 'r', encoding='utf-8') as fh:
        cases = json.load(fh)
    t0 = time.time()
    out = run_batch(cases['cases'] if isinstance(cases, dict) else cases)
    with open(args.batch[1], 'w', encoding='utf-8') as fh:
        json.dump(out, fh)
    print('oracle_ext: %d cases, %.1f s -> %s' % (len(out), time.time() - t0, args.batch[1]), file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
