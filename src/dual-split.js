/* BIOBUZZ Shot Sim - issue M2: dual-wheel impulse-momentum energy split. Engine extension "dualSplit".
   Browser / worker: window.ShotDualSplit (also registered on ShotEngine). Node: module.exports. Design: process_docs/issue-m2/design.md
   The ball leaves with linear momentum m v and spin I_b w = c m r^2 S0 v / r. Each wheel gives a forward tangential impulse
   (normal impulses cancel):  J_B + J_T = m v,  J_B - J_T = c S0 m v.  Work drawn from wheel i = J_i V_i with V_T = k V_B, and the
   calibrated TOTAL  E_tot = lossFactor (1/2 m v^2 + 1/2 I_b w^2)  is only split:
     s_B = (1 + c S0) / ((1 + c S0) + k (1 - c S0)),  E_B = s_B E_tot,  E_T = (1 - s_B) E_tot.        (c = 0 -> the old 1 / (1 + k))
   Each wheel: w1 = sqrt(max(0, w0^2 - 2 E / I)), dip = 1 - w1 / w0 (top starts at k w0_bottom). The next ball leaves at a speed
   proportional to V_B + V_T, so the exit-speed dip is dip_x = (dip_B + k dip_T) / (1 + k) and the leftover at the next shot
   residual = (res_B + k res_T) / (1 + k). Same motor / gear / diameter on both wheels: tau_i = tauS I_i / I_B. Recovery time = slower wheel.
   motor(inp) -> { share, shareTop, EBJ, ETJ, EtotJ, w0B, w0T, w1B, w1T, dipB, dipT, dipExit, resB, resT, wdtB, wdtT, residual,
                   recoveryS (Infinity = never), spinS, c, JB_over_mv, JT_over_mv }
     inp = { ball: { massKg, I, rIn }, vExit, S0, k, vBottom (bottom surface speed m/s), wheelRadiusM, IB, IT, lossFactor,
             control: 'pid' | 'power', tauS (bottom wheel), wFree (rad/s), dt (s) }
   rows(m, dt, fmt) -> [{ what, formula, numbers, result }] extra Show-the-math rows for a dual result m = E.motorModel(...), dt = m.details;
     fmt = { f(x, digits), pct(x, digits), sci(x), ms(x) } (the page's formatters).
   recoveryRows(m, dt, fmt) -> rows for the recovery part (each wheel back to speed, exit-weighted leftover), same format.
   Engine hook: motorCore calls E._internal.ext('dualSplit').motor(...) for type 'dual' only; without this file the legacy formula runs. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.ShotDualSplit = factory(root.ShotEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  var IN_M = 0.0254, TOL = 0.01;   // TOL: open-loop "back within 1 %" (as motorCore)

  function w1Of(w0, EJ, I) { return Math.sqrt(Math.max(0, w0 * w0 - 2 * EJ / I)); }
  function dipOf(w0, w1) { return w0 > 0 ? 1 - w1 / w0 : 0; }

  // one wheel's recovery: { rec (s), res (fraction still missing after dt), wdt (rad/s) }
  function recover(pid, w0, w1, dip, wFree, tau, dt) {
    var rec, res, wdt;
    if (pid) {
      rec = w0 < wFree ? tau * Math.log((wFree - w1) / (wFree - w0)) : Infinity;
      wdt = Math.min(w0, wFree - (wFree - w1) * Math.exp(-dt / tau));
      res = w0 > 0 ? Math.max(0, 1 - wdt / w0) : 0;
    } else {
      rec = dip > TOL ? tau * Math.log(dip / TOL) : 0;
      res = dip * Math.exp(-dt / tau);
      wdt = w0 * (1 - res);
    }
    return { rec: rec, res: res, wdt: wdt };
  }

  function motor(inp) {
    var b = inp.ball, k = inp.k, S0 = inp.S0, pid = inp.control === 'pid', rM = b.rIn * IN_M;
    var c = b.I / (b.massKg * rM * rM);
    var spinW = S0 * inp.vExit / rM;
    var EtotJ = inp.lossFactor * (0.5 * b.massKg * inp.vExit * inp.vExit + 0.5 * b.I * spinW * spinW);
    var a = 1 + c * S0, bb = 1 - c * S0, den = a + k * bb;
    var share = a / den, shareTop = k * bb / den, EBJ = share * EtotJ, ETJ = shareTop * EtotJ;
    var w0B = inp.vBottom / inp.wheelRadiusM, w0T = k * w0B;
    var w1B = w1Of(w0B, EBJ, inp.IB), w1T = w1Of(w0T, ETJ, inp.IT);
    var dipB = dipOf(w0B, w1B), dipT = dipOf(w0T, w1T), dipExit = (dipB + k * dipT) / (1 + k);
    var tauT = inp.tauS * inp.IT / inp.IB;
    var rB = recover(pid, w0B, w1B, dipB, inp.wFree, inp.tauS, inp.dt), rT = recover(pid, w0T, w1T, dipT, inp.wFree, tauT, inp.dt);
    var spinS = pid ? (w0B < inp.wFree ? inp.tauS * Math.log(inp.wFree / (inp.wFree - w0B)) : Infinity)
      : (w0B <= inp.wFree ? inp.tauS * Math.log(100) : Infinity);
    return {
      share: share, shareTop: shareTop, EBJ: EBJ, ETJ: ETJ, EtotJ: EtotJ, w0B: w0B, w0T: w0T, w1B: w1B, w1T: w1T,
      dipB: dipB, dipT: dipT, dipExit: dipExit, resB: rB.res, resT: rT.res, wdtB: rB.wdt, wdtT: rT.wdt,
      residual: (rB.res + k * rT.res) / (1 + k), recoveryS: Math.max(rB.rec, rT.rec), spinS: spinS,
      c: c, JB_over_mv: a / 2, JT_over_mv: bb / 2
    };
  }

  function rows(m, dt, fmt) {
    var f = fmt.f, pct = fmt.pct, sci = fmt.sci, out = [];
    if (!m || !dt || dt.type !== 'dual' || dt.splitModel !== 'impulse') return out;
    var k = dt.topRatio, eBall = dt.keLinJ + dt.keRotJ, cS = dt.cBall * m.S0;
    out.push({ what: 'Impulse split between the wheels', formula: 's_B = (1 + c·S) ÷ ((1 + c·S) + k·(1 − c·S)),  c = I_ball ÷ (m·r²)',
      numbers: 'c ' + f(dt.cBall, 3) + ', S ' + f(m.S0, 2) + ', k ' + f(k, 2) + ': (1 + ' + f(cS, 3) + ') ÷ ((1 + ' + f(cS, 3) + ') + ' + f(k, 2) + ' × (1 − ' + f(cS, 3) + '))', result: 'bottom ' + pct(dt.share, 1) + ' / top ' + pct(dt.shareTop, 1) });
    out.push({ what: 'Top wheel energy', formula: 'E_T = (1 − s_B) × 2 E_ball', numbers: '(1 − ' + f(dt.share, 3) + ') × 2 × ' + f(eBall, 3), result: f(dt.shotEnergyTopJ, 3) + ' J' });
    out.push({ what: 'Top wheel inertia', formula: 'I_T = I_B  (one shaft inertia is entered; both wheels use it)', numbers: sci(dt.inertiaKgM2) + ' kg·m²', result: sci(dt.inertiaTopKgM2) + ' kg·m²' });
    out.push({ what: 'Top wheel speed before / after the shot', formula: 'ω_T0 = k × ω_B0,  ω_T1 = √(ω_T0² − 2 E_T ÷ I_T)',
      numbers: f(k, 2) + ' × ' + f(dt.w0, 1) + ';  √(' + f(dt.w0Top, 1) + '² − 2 × ' + f(dt.shotEnergyTopJ, 3) + ' ÷ ' + sci(dt.inertiaTopKgM2) + ')', result: f(dt.w0Top, 1) + ' → ' + f(dt.w1Top, 1) + ' rad/s' });
    out.push({ what: 'Top wheel dip', formula: 'dip_T = 1 − ω_T1 ÷ ω_T0', numbers: '1 − ' + f(dt.w1Top, 1) + ' ÷ ' + f(dt.w0Top, 1), result: pct(m.dipTop, 2) });
    out.push({ what: 'Dip of the exit speed', formula: 'dip_x = (dip_B + k × dip_T) ÷ (1 + k)  (a ball leaves at a speed ∝ V_B + V_T; bursts and σ_recovery use this)',
      numbers: '(' + pct(m.dip, 2) + ' + ' + f(k, 2) + ' × ' + pct(m.dipTop, 2) + ') ÷ (1 + ' + f(k, 2) + ')', result: pct(m.dipExit, 2) });
    return out;
  }

  // recovery rows (after the time constant): each wheel back to speed (slower one decides), exit-weighted leftover at the next shot
  function recoveryRows(m, dt, fmt) {
    var f = fmt.f, pct = fmt.pct, ms = fmt.ms, k, pid, tauT, rB, rT, out = [];
    if (!m || !dt || dt.type !== 'dual' || dt.splitModel !== 'impulse') return out;
    k = dt.topRatio; pid = m.control === 'pid'; tauT = m.tauS * dt.inertiaTopKgM2 / dt.inertiaKgM2;
    rB = recover(pid, dt.w0, dt.w1, m.dip, dt.wFree, m.tauS, dt.shotInterval);
    rT = recover(pid, dt.w0Top, dt.w1Top, m.dipTop, dt.wFree, tauT, dt.shotInterval);
    out.push({ what: pid ? 'Back to speed, each wheel (full power)' : 'Back within 1%, each wheel (no boost)',
      formula: pid ? 't = τ × ln((ω_free − ω₁) ÷ (ω_free − ω₀)) per wheel; the slower wheel decides' : 't = τ × ln(dip ÷ 1%) per wheel; the slower wheel decides',
      numbers: 'bottom ' + ms(1000 * rB.rec) + ', top ' + ms(1000 * rT.rec), result: ms(m.recoveryMs) });
    out.push({ what: 'Still missing at the next shot (exit speed)', formula: 'leftover = (left_B + k × left_T) ÷ (1 + k), each wheel as for one wheel',
      numbers: 'Δt = ' + f(dt.shotInterval, 2) + ' s: (' + pct(rB.res, 2) + ' + ' + f(k, 2) + ' × ' + pct(rT.res, 2) + ') ÷ (1 + ' + f(k, 2) + ')', result: pct(m.residual, 2) });
    return out;
  }

  var impl = { motor: motor, rows: rows, recoveryRows: recoveryRows };
  var I = E && E._internal;
  if (I && typeof I.register === 'function') I.register('dualSplit', impl);
  return impl;
});
