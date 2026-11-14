"""Independent oracle for the flywheel energy split and recovery (issue M2, card N6).
Written from the physics, NOT ported from src/dual-split.js / engine.js motorCore: no closed form for the shares or the speed
loss, no exponential for the recovery.
  - ball inertia: numeric shell integral (Simpson), I_b = (2/3) int rho 4 pi r^4 dr
  - contact impulses: the 2x2 system  J_B + J_T = m v,  J_B - J_T = I_b w / r  solved by Gaussian elimination
  - energy drawn from each wheel = J_i V_i (V_T = k V_B), scaled so that the total is lossFactor (KE_lin + KE_rot)
  - wheel speed after the shot: integrate  d w / d E = -1 / (I w)  with RK4 over 2000 equal energy increments
  - recovery: RK4 on  d w / dt = (w_target - w) / tau  (PID: target = free speed, stop at the set speed; open loop: target = set speed)
Usage:  python3 oracle_motor.py            -> JSON {"cases":[{"in":..,"out":..}]} for the built-in grid on stdout
        python3 oracle_motor.py --stdin    -> same for cases given as JSON {"cases":[{"in":..}]} on stdin
        python3 oracle_motor.py --selftest -> invariants + negative control, prints 'selftest ok' (exit 1 on failure)
Case input: id, kind 'single'|'dual', v (exit m/s), k (dual top/bottom surface ratio), control 'pid'|'power', motor {freeRpm, stallTorqueNm},
gear, motors, diameterMm, inertia (per shaft), shotInterval, batteryV, ratedV, freeSpeedFactor, lossFactor, etaSingle, etaDual,
ball {Din, massLb, wallIn, Ib?}."""
import json, math, sys

IN_M, LB_KG = 0.0254, 0.45359237
MODEL = dict(batteryV=12.0, ratedV=12.0, freeSpeedFactor=0.97, lossFactor=2.0, etaSingle=0.45, etaDual=0.9)
POLLEN = dict(Din=2.80, massLb=0.055, wallIn=0.070)
MOTORS = {'yj6000': (6000.0, 0.1442), 'yj1620': (1620.0, 0.5296)}


def shell_inertia(ball, n=2000):  # Simpson on I = (2/3) rho int 4 pi r^4 dr, rho from the mass
    R = ball['Din'] / 2 * IN_M; Ri = R - ball['wallIn'] * IN_M; m = ball['massLb'] * LB_KG
    rho = m / (4 / 3 * math.pi * (R ** 3 - Ri ** 3)); h = (R - Ri) / n
    f = lambda r: 4 * math.pi * r ** 4
    s = f(Ri) + f(R) + sum((4 if i % 2 else 2) * f(Ri + i * h) for i in range(1, n))
    return m, R, 2 / 3 * rho * s * h / 3


def solve2(a, b):  # 2x2 linear system by Gaussian elimination with partial pivoting
    a = [r[:] for r in a]; b = b[:]
    if abs(a[1][0]) > abs(a[0][0]): a[0], a[1] = a[1], a[0]; b[0], b[1] = b[1], b[0]
    f = a[1][0] / a[0][0]; a[1][1] -= f * a[0][1]; b[1] -= f * b[0]
    y = b[1] / a[1][1]
    return [(b[0] - a[0][1] * y) / a[0][0], y]


def rk4(f, y, t, h):
    k1 = f(t, y); k2 = f(t + h / 2, y + h / 2 * k1); k3 = f(t + h / 2, y + h / 2 * k2); k4 = f(t + h, y + h * k3)
    return y + h / 6 * (k1 + 2 * k2 + 2 * k3 + k4)


def after_shot(w0, E, I, n=2000):  # draw E from a wheel in n equal increments: d w / d E = -1 / (I w)
    if w0 <= 0 or E <= 0: return w0
    w, dE = w0, E / n
    for _ in range(n):
        if w <= 1e-9 * w0: return 0.0
        w = rk4(lambda e, y: -1.0 / (I * y), w, 0.0, dE)
        if w <= 0 or math.isnan(w): return 0.0
    return w


def advance(w, target, tau, t_end, stop=None, h=None):  # RK4 on dw/dt = (target - w)/tau; returns (w, t, stopped_at | None)
    h = h or tau / 500; t = 0.0; f = lambda _t, y: (target - y) / tau
    while t < t_end - 1e-15:
        hh = min(h, t_end - t); w2 = rk4(f, w, t, hh)
        if stop is not None and w2 >= stop:       # crossing inside this step: bisect on the step length (RK4 map, no closed form)
            lo, hi = 0.0, hh
            for _ in range(60):
                mid = (lo + hi) / 2
                if rk4(f, w, t, mid) >= stop: hi = mid
                else: lo = mid
            return stop, t + hi, t + hi
        w, t = w2, t + hh
    return w, t, None


def wheel(w0, w1, wfree, tau, control, dt):
    dip = 1 - w1 / w0 if w0 > 0 else 0.0
    if w0 <= 0: return dict(dip=0.0, res=0.0, rec=0.0, wdt=0.0)
    if control == 'pid':
        rec = float('inf')
        if w0 < wfree: rec = advance(w1, wfree, tau, 1e9, stop=w0)[1]
        wdt = min(w0, advance(w1, wfree, tau, dt)[0])
        return dict(dip=dip, res=max(0.0, 1 - wdt / w0), rec=rec, wdt=wdt)
    rec = 0.0 if dip <= 0.01 else advance(w1, w0, tau, 1e9, stop=w0 * 0.99)[1]
    wdt = advance(w1, w0, tau, dt)[0]
    return dict(dip=dip, res=1 - wdt / w0, rec=rec, wdt=wdt)


def spin_up(w0, wfree, tau, control):
    if control == 'pid': return advance(0.0, wfree, tau, 1e9, stop=w0)[1] if w0 < wfree else float('inf')
    return advance(0.0, w0, tau, 1e9, stop=0.99 * w0)[1] if w0 <= wfree else float('inf')


def run(c):
    M = {**MODEL, **{k: c[k] for k in MODEL if k in c}}; ball = c.get('ball', POLLEN)
    m, r, Ib = shell_inertia(ball)
    if 'Ib' in ball: Ib = ball['Ib']
    dual = c['kind'] == 'dual'; k = c['k'] if dual else 0.0; v = c['v']
    S0 = (1 - k) / (1 + k) if dual else (-1.0 if c.get('spin') == 'top' else 1.0)
    eta = M['etaDual'] * (1 + k) / 2 if dual else M['etaSingle']
    Rw = c['diameterMm'] / 2000; VB = v / eta; w0B = VB / Rw; w0T = k * w0B
    free = c['motor']['freeRpm'] * M['freeSpeedFactor'] * M['batteryV'] / M['ratedV']
    wfree = free * c['gear'] * 2 * math.pi / 60
    Tws = c['motors'] * c['motor']['stallTorqueNm'] * M['batteryV'] / M['ratedV'] / c['gear']
    I = c['inertia']; tau = I * wfree / Tws
    w_ball = S0 * v / r; Etot = M['lossFactor'] * (0.5 * m * v * v + 0.5 * Ib * w_ball ** 2)
    if dual:
        JB, JT = solve2([[1, 1], [1, -1]], [m * v, Ib * w_ball / r]); WB, WT = JB * VB, JT * k * VB
        sB = WB / (WB + WT)
    else:
        JB, JT, sB = m * v, 0.0, 1.0
    EB, ET = sB * Etot, (1 - sB) * Etot
    w1B = after_shot(w0B, EB, I); w1T = after_shot(w0T, ET, I) if dual else 0.0
    B = wheel(w0B, w1B, wfree, tau, c['control'], c['shotInterval'])
    out = dict(S0=S0, c=Ib / (m * r * r), JB_over_mv=JB / (m * v), JT_over_mv=JT / (m * v), share=sB, shareTop=1 - sB, EtotJ=Etot, shotEnergyJ=EB, shotEnergyTopJ=ET,
               w0=w0B, w1=w1B, wAfterInterval=B['wdt'], tauS=tau, dip=B['dip'], residual=B['res'], recoveryMs=1000 * B['rec'], spinUpMs=1000 * spin_up(w0B, wfree, tau, c['control']))
    if dual:
        T = wheel(w0T, w1T, wfree, tau, c['control'], c['shotInterval'])
        out.update(w0Top=w0T, w1Top=w1T, dipTop=T['dip'], dipExit=(B['dip'] + k * T['dip']) / (1 + k),
                   residual=(B['res'] + k * T['res']) / (1 + k), recoveryMs=1000 * max(B['rec'], T['rec']))
    return out


def base(kind, **o):
    d = dict(kind=kind, v=9.0, k=0.45, control='pid', motor=dict(zip(('freeRpm', 'stallTorqueNm'), MOTORS['yj6000'])), gear=1, motors=1, diameterMm=96,
             inertia=4e-4, shotInterval=0.5, ball=POLLEN, **MODEL)
    d.update(o); return d


def grid():
    cs = []
    for kind in ('single', 'dual'):
        for k in ([0.2, 0.3, 0.45, 0.6, 0.8, 1.0] if kind == 'dual' else [0.0]):
            for control in ('pid', 'power'):
                for mname in ('yj6000', 'yj1620'):
                    for dt in (0.03, 0.5, 2.0):
                        v = 9.0 if mname == 'yj6000' else 3.0
                        cs.append(base(kind, k=k, control=control, shotInterval=dt, v=v, motor=dict(zip(('freeRpm', 'stallTorqueNm'), MOTORS[mname])),
                                       gear=1 if mname == 'yj6000' else 2, motors=1 if mname == 'yj6000' else 2, inertia=4e-4 if dt != 2.0 else 1e-3,
                                       id=f'{kind}-k{k}-{control}-{mname}-dt{dt}'))
    for kind in ('single', 'dual'):   # speed above what the motor can reach: recovery and spin-up never finish
        cs.append(base(kind, v=9.0, k=0.45, motor=dict(zip(('freeRpm', 'stallTorqueNm'), MOTORS['yj1620'])), id=f'{kind}-unreachable'))
    return cs


def old_bottom_energy(c):  # the model before M2: bottom wheel carries 1 / (1 + k) of the total
    return run(c)['EtotJ'] / (1 + c['k'])


def selftest():
    ok = True
    def chk(cond, msg):
        nonlocal ok
        if not cond: ok = False; print('FAIL', msg)
    for c in grid():
        o = run(c)
        chk(abs(o['JB_over_mv'] + o['JT_over_mv'] - 1) < 1e-12, c['id'] + ' linear momentum')
        chk(abs((o['JB_over_mv'] - o['JT_over_mv']) - o['c'] * o['S0']) < 1e-12 or c['kind'] == 'single', c['id'] + ' angular momentum')
        chk(abs(o['shotEnergyJ'] + o['shotEnergyTopJ'] - o['EtotJ']) < 1e-12 * o['EtotJ'], c['id'] + ' energy total')
        chk(abs(o['w0'] ** 2 - o['w1'] ** 2 - 2 * o['shotEnergyJ'] / c['inertia']) < 1e-7 * o['w0'] ** 2, c['id'] + ' wheel energy (RK4 vs 1/2 I w^2)')
        if c['kind'] == 'dual' and c['k'] == 1.0:
            chk(abs(o['share'] - 0.5) < 1e-12 and abs(o['dip'] - o['dipTop']) < 1e-9, c['id'] + ' k=1 symmetric')
    # point-mass ball (I_b = 0): the old share 1/(1+k) is the special case of the impulse split
    for k in (0.2, 0.45, 0.8):
        o = run(base('dual', k=k, ball=dict(POLLEN, Ib=0.0)))
        chk(abs(o['share'] - 1 / (1 + k)) < 1e-12, f'c=0 gives 1/(1+k) at k {k}')
    # RK4 recovery against the exponential law (self-check of the integrator only)
    w, wf, tau = 200.0, 600.0, 0.7
    chk(abs(advance(100.0, wf, tau, 0.5)[0] - (wf - (wf - 100.0) * math.exp(-0.5 / tau))) < 1e-9, 'RK4 recovery vs exp')
    # NEGATIVE CONTROL: the old 1/(1+k) bottom share must disagree with this oracle (by > 8 % of the bottom energy at k = 0.3)
    c = base('dual', k=0.3); new = run(c)['shotEnergyJ']; old = old_bottom_energy(c)
    chk(abs(new - old) / old > 0.08, f'negative control: new {new:.4f} vs old {old:.4f}')
    print('selftest ok' if ok else 'selftest FAILED'); return 0 if ok else 1


if __name__ == '__main__':
    if '--selftest' in sys.argv: sys.exit(selftest())
    cs = json.load(sys.stdin)['cases'] if '--stdin' in sys.argv else [{'in': c} for c in grid()]
    name = lambda x: 'NaN' if x != x else ('Infinity' if x > 0 else '-Infinity')
    fin = lambda o: {k: (name(x) if isinstance(x, float) and not math.isfinite(x) else x) for k, x in o.items()}   # non-finite -> string (valid JSON)
    print(json.dumps({'cases': [{'in': c['in'], 'out': fin(run(c['in']))} for c in cs]}))
