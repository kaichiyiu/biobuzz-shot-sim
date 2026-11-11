# -*- coding: utf-8 -*-
"""
Oracle extension, hood part (split seam of oracle_ext.py): widest-window launch angle on an oracle-built rect-hit grid.

  hood_ext(case, hood, axes, field=None) -> {angle_deg, v_window: [lo, hi] m/s, rpm_window | None, range_deg, speed_cut, yaw_cut, ...}
  case  = shot case without theta/v/yaw (oracle_ext.py fields) + kind "hood"; optional v_cap (motor limit, m/s), rpm_per_mps and
          at = {angle_deg, yaw_deg: number | [numbers]}: also report at_rect = per yaw the rect-hit flags over the speed nodes at
          exactly that angle - a physics check of someone else's aim that does not depend on the tie rules below
  hood  = {"mode": "fixed", "angleDeg"} | {"mode": "adjustable", "minDeg", "maxDeg"} (already normalised)
  axes  = nodes like the engine's fine view: angles theta0 + i*th_step (|i|*th_step <= th_span, adjustable only, inside the hood
          range, 1..89.75), yaws yaw0 + i*yaw_step (<= yaw_span), speeds v0*exp(0.005*i), i_lo <= i <= i_hi. Defaults: steps 0.25,
          spans 6 deg, i +-24 (wider steps save oracle time, ~1.5k shots/s). speed_cut / yaw_cut: the window / yaw run touches an
          axis end. Also angle_widths [[theta, width]], tie_step (one speed step at the widest window).
Rules (engine-hood-core.js header + SPEC D15), written independently: per angle the widest speed run over all yaws (ties ->
lower); yaws within one speed step of the widest form a plateau whose middle yaw gives the angle's window; the optimal angle is
the widest one, angles within one speed step are tied, the tied run holding the widest angle is recommended and its middle node
is the answer (between nodes: the side of the widest angle). Advised aim (D15): start at the widest run's middle speed and the
plateau-middle yaw, then alternate speed <- middle of the speed run, yaw <- middle of the yaw run (<= 10 rounds; a 2-cycle keeps
its first point); the window is the speed run at the final yaw; a yaw run cut by the yaw axis falls back to the centre yaw.
"""
import math
import numpy as np
from oracle_ext import classify_batch

EPS = 1e-12

def runs1d(row):
    out, lo = [], None
    for i, on in enumerate(list(row) + [False]):
        if on and lo is None:
            lo = i
        if not on and lo is not None:
            out.append((lo, i - 1))
            lo = None
    return out

def step_at(sp, b):
    return sp[b + 1] - sp[b] if b + 1 < len(sp) else sp[b] - sp[max(0, b - 1)]

def widest_run(row, sp):
    best = None
    for lo, hi in runs1d(row):
        if best is None or sp[hi] - sp[lo] > best[2]:
            best = (lo, hi, sp[hi] - sp[lo])
    return best

def run_near(row, i):
    """Run (lo, hi) of True in row that contains i, else the nearest one (ties -> lower); None when the row has none."""
    best, bd = None, None
    for lo, hi in runs1d(row):
        d = lo - i if i < lo else (i - hi if i > hi else 0)
        if bd is None or d < bd:
            best, bd = (lo, hi), d
    return best

def near_mid(sp, lo, hi):
    mid, b = (sp[lo] + sp[hi]) / 2, lo
    for i in range(lo, hi + 1):
        if abs(sp[i] - mid) < abs(sp[b] - mid) - EPS:
            b = i
    return b

def widest_windows(H, sp, top):
    """AngleWindow per angle index: {a, width, bLo, bHi, c, cLo, cHi}; width 0 / bLo -1 when the angle has no run."""
    out = []
    for a in range(H.shape[0]):
        runs = [widest_run(H[a, :top + 1, c], sp) for c in range(H.shape[2])]
        ws = [r[2] if r else -1.0 for r in runs]
        cm = int(np.argmax(ws))                      # first maximum -> lower yaw on ties
        if ws[cm] < 0:
            out.append(dict(a=a, width=0.0, bLo=-1, bHi=-1, c=-1, cLo=-1, cHi=-1))
            continue
        tol, lo, hi = step_at(sp, runs[cm][1]), cm, cm
        while lo > 0 and ws[lo - 1] >= ws[cm] - tol - EPS:
            lo -= 1
        while hi < len(ws) - 1 and ws[hi + 1] >= ws[cm] - tol - EPS:
            hi += 1
        c = (lo + hi) // 2
        out.append(dict(a=a, width=ws[cm], bLo=runs[c][0], bHi=runs[c][1], c=c, cLo=lo, cHi=hi))
    return out

def pick_optimal(aws, sp):
    ok = [w for w in aws if w['bLo'] >= 0]
    if not ok:
        return None
    m = max(ok, key=lambda w: (w['width'], -w['a']))       # widest, ties -> lower angle
    floor = m['width'] - step_at(sp, m['bHi']) - EPS
    tied = [w['bLo'] >= 0 and w['width'] >= floor for w in aws]
    runs = [(lo, hi) for lo, hi in runs1d(tied)]
    lo, hi = next(r for r in runs if r[0] <= m['a'] <= r[1])
    mid = (lo + hi) / 2
    a = int(mid) if mid == int(mid) else (math.ceil(mid) if m['a'] >= mid else math.floor(mid))
    return dict(a=a, aLo=lo, aHi=hi, width=m['width'], others=[r for r in runs if r != (lo, hi)])

def centre_aim(H, sp, a, b, c, top):
    seen = [(b, c)]
    for _ in range(10):
        rb = run_near(H[a, :top + 1, c], b)
        if rb is None:
            return seen[-1]
        nb = near_mid(sp, *rb)
        rc = run_near(H[a, nb, :], c)
        nxt = (nb, (rc[0] + rc[1]) // 2 if rc else c)
        if nxt in seen:
            return nxt if seen.index(nxt) == len(seen) - 1 else seen[seen.index(nxt)]
        seen.append(nxt); b, c = nxt
    return seen[-1]

def analyse(H, th, sp, adjustable, v_cap=None):
    """Window analysis of a boolean rect-hit grid H[angle, speed, yaw] (pure, testable on synthetic grids)."""
    nB, nC = H.shape[1:]
    top = nB - 1 if v_cap is None else max([i for i, v in enumerate(sp) if v <= v_cap * (1 + EPS)] or [-1])
    if top < 0:
        return None
    aws = widest_windows(H, sp, top)
    opt = pick_optimal(aws, sp) if adjustable else None
    aw = (aws[opt['a']] if opt else None) if adjustable else aws[0]
    if aw is None or aw['bLo'] < 0:
        return None
    a = aw['a']
    b, c = centre_aim(H, sp, a, near_mid(sp, aw['bLo'], aw['bHi']), aw['c'], top)
    rb = run_near(H[a, :top + 1, c], b)
    nb = (rb[0] + rb[1]) // 2
    rc = run_near(H[a, nb, :], c)
    ycut = bool(rc and (rc[0] == 0 or rc[1] == nC - 1))
    r2 = run_near(H[a, :top + 1, nC // 2], nb) if ycut else None   # yaw run cut by the axis: centre yaw, speed re-centred there
    rb, c = (r2, nC // 2) if r2 else (rb, c)
    return dict(angle_deg=th[a], v_window=[sp[rb[0]], sp[rb[1]]], width=sp[rb[1]] - sp[rb[0]], yaw_index=c,
                range_deg=[th[opt['aLo']], th[opt['aHi']]] if opt else None, speed_cut=rb[0] == 0 or rb[1] == nB - 1,
                yaw_cut=ycut, angle_widths=[[th[w['a']], w['width']] for w in aws], tie_step=step_at(sp, aw['bHi']))

def build_axes(hood, ax):
    ts, ys = ax.get('th_step', 0.25), ax.get('yaw_step', 0.25)
    if hood['mode'] == 'fixed':
        th = [float(hood['angleDeg'])]
    else:
        n = int(math.ceil(ax.get('th_span', 6.0) / ts - 1e-9))
        th = [ax['theta0'] + i * ts for i in range(-n, n + 1)]
        th = [t for t in th if 1 <= t <= 89.75 and hood['minDeg'] - 1e-9 <= t <= hood['maxDeg'] + 1e-9]
    n = int(math.ceil(ax.get('yaw_span', 6.0) / ys - 1e-9))
    yaws = [ax['yaw0'] + i * ys for i in range(-n, n + 1)]
    sp = [ax['v0'] * math.exp(0.005 * i) if i else ax['v0'] for i in range(ax.get('i_lo', -24), ax.get('i_hi', 24) + 1)]
    return th, sp, yaws

def hood_ext(case, hood, axes, field=None):
    th, sp, ys = build_axes(hood, axes)
    shots = [{'theta': t, 'v': v, 'yaw': y} for t in th for v in sp for y in ys]
    base = {k: v for k, v in case.items() if k not in ('kind', 'hood', 'axes', 'shots', 'v_cap', 'rpm_per_mps')}
    r = classify_batch([dict(base, shots=shots)], field, dt=1e-3)[0]
    H = np.array([x['rect_hit'] for x in r], bool).reshape(len(th), len(sp), len(ys))
    out = analyse(H, th, sp, hood['mode'] == 'adjustable', case.get('v_cap'))
    if out is None:
        return {'angle_deg': None, 'v_window': None, 'rpm_window': None, 'n_rect': int(H.sum())}
    k, at, aw = case.get('rpm_per_mps'), case.get('at'), None
    if at:                                                      # rect flags over the speed nodes at exactly the given angle, per yaw
        yy = at['yaw_deg'] if isinstance(at['yaw_deg'], list) else [at['yaw_deg']]
        ra = classify_batch([dict(base, shots=[{'theta': at['angle_deg'], 'v': v, 'yaw': y} for y in yy for v in sp])], field, dt=1e-3)[0]
        aw = [[x['rect_hit'] for x in ra[i * len(sp):(i + 1) * len(sp)]] for i in range(len(yy))]
    return dict(out, yaw_deg=ys[out['yaw_index']], n_rect=int(H.sum()), at_rect=aw, rpm_window=[k * v for v in out['v_window']] if k else None)

def selftest(field=None):
    n = [0, 0]

    def chk(name, cond):
        n[0 if cond else 1] += 1
        print(('  ok   ' if cond else '  FAIL ') + name)
    sp = [5.0 * math.exp(0.01 * i) for i in range(40)]
    lin = [5.0 + 0.1 * i for i in range(40)]

    def grid(spec, nA=7, nC=5):                    # spec: {(a, c): (bLo, bHi)} -> boolean grid
        H = np.zeros((nA, 40, nC), bool)
        for (a, c), (lo, hi) in spec.items():
            H[a, lo:hi + 1, c] = True
        return H
    col = lambda a, lo, hi: {(a, 2): (lo, hi)}
    th = [float(i) for i in range(7)]
    chk('h1 single widest angle wins', analyse(grid({**col(1, 10, 14), **col(3, 10, 22), **col(5, 10, 14)}), th, sp, True)['angle_deg'] == 3.0)
    chk('h2 two angles within one speed step tie: the node on the widest side', analyse(grid({**col(2, 10, 20), **col(3, 10, 19)}), th, sp, True)['angle_deg'] == 2.0)
    r = analyse(grid({**col(2, 10, 20), **col(3, 10, 20), **col(4, 10, 19)}), th, sp, True)
    chk('h3 three tied angles: the middle one, range = the tied run', r['angle_deg'] == 3.0 and r['range_deg'] == [2.0, 4.0])
    H = grid({**col(0, 10, 19), **col(4, 10, 20), **col(5, 10, 20)})
    chk('h4 two tied runs: the run with the widest angle wins, the other is only listed',
        analyse(H, th, sp, True)['angle_deg'] == 4.0 and pick_optimal(widest_windows(H, sp, 39), sp)['others'] == [(0, 0)])
    aw = widest_windows(grid({(3, 1): (5, 8), (3, 2): (5, 8), (3, 3): (5, 8), (3, 0): (5, 7), (3, 4): (5, 7)}), sp, 39)[3]
    chk('h5 yaw plateau within one step: middle yaw c = 2, window at c', (aw['cLo'], aw['cHi'], aw['c'], aw['bLo'], aw['bHi']) == (0, 4, 2, 5, 8))
    row = np.zeros(40, bool)
    row[3:7] = row[10:14] = True
    chk('h6 equal runs in a column: the lower run; no hit -> None', widest_run(row, lin)[:2] == (3, 6) and analyse(np.zeros((3, 40, 5), bool), [1.0, 2.0, 3.0], sp, False) is None)
    H = grid({(3, c): (10, 30) for c in range(5)})
    chk('h7 motor cap clips the window at the highest allowed node', analyse(H[3:4], th[3:4], sp, False, v_cap=sp[24])['v_window'][1] == sp[24])
    Hc = np.zeros((1, 40, 5), bool)
    Hc[0, 10:21, 1] = Hc[0, 20:31, 3] = True
    chk('h8 centre aim ends inside a run (cycle keeps its first point)', centre_aim(Hc, sp, 0, 15, 1, 39)[0] in range(10, 31))
    ax = {'yaw0': 90.0, 'yaw_span': 3.0, 'yaw_step': 0.5, 'v0': 5.2, 'i_lo': -16, 'i_hi': 30}
    case = {'mouth': {'x': -12.75, 'y': -48, 'height': 16}, 'target': 'red'}
    o = hood_ext(case, {'mode': 'fixed', 'angleDeg': 65.0}, ax, field)
    chk('h9 fixed 65 deg end to end: window found, its edge nodes are rect hits',
        o['v_window'] is not None and all(classify_batch([dict(case, theta=65.0, v=v, yaw=90.0)], field)[0]['rect_hit'] for v in o['v_window']))
    print('oracle_ext_hood selftest: %d passed, %d failed' % tuple(n))
    return n[1] == 0
