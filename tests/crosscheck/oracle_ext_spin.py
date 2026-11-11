# -*- coding: utf-8 -*-
"""
Oracle extension, spin part (split seam of oracle_ext.py, which is at its line limit): single-wheel TOPSPIN.

oracle.py clamps the lift one-sided: lift = klc * min(w r, |v|). For topspin (w r < 0) nothing bounds it from below, so once the
ball slows below |w r| the oracle's lift ratio S = w r / |v| would pass -1, while the engine clamps S to [-smax, +smax]
(smax = clSMax = 1). install() replaces oracle.accel by the symmetric clamp  klc * min(max(w r, -|v|), |v|)  - identical to
oracle.py for w r >= 0, so back-spin results do not change. oracle.py itself is never edited; rk4_step looks accel up by name,
so every oracle flight (simulate, oracle_ext.entry_velocity) uses the patched function once oracle_ext has imported this module.

  s0_of(case) -> launch spin ratio: case["S0"] (default 1.0) for spin "back" (default), -|S0| for "top" (single wheel);
                 other spin values raise ValueError. Dual shooters never use "top" (the engine ignores it) - pass S0 and "back".
"""
import numpy as np

import oracle as O


def accel_sym(vr, vz, kd, klc, wr):
    """a = -kd|v|v + kl|v|(-vz, vr) - g z_hat with the lift ratio clamped to [-1, 1]."""
    s = np.sqrt(vr * vr + vz * vz)
    lift = klc * np.minimum(np.maximum(wr, -s), s)
    return -kd * s * vr - lift * vz, -kd * s * vz + lift * vr - O.G


def install():
    O.accel = accel_sym


def s0_of(case):
    spin, s0 = str(case.get('spin', 'back')), float(case.get('S0', 1.0))
    if spin not in ('back', 'top'):
        raise ValueError('spin %r is not "back" or "top"' % (spin,))
    return -abs(s0) if spin == 'top' else s0


install()
