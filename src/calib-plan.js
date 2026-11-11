/* BIOBUZZ Shot Sim - #11 calibration test plan: low / middle / top rpm x hood angle(s), 5 shots each, with the landing
   distance the current eta predicts (tape positions, and a check on the setup). Pure; engine passed as opts.engine.
   Browser: window.CalibPlan. Node: module.exports. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calib-core.js'));
  else root.CalibPlan = factory(root.CalibCore);
})(typeof self !== 'undefined' ? self : this, function (Core) {
  'use strict';
  var SHOTS = 5, TAPE_MIN_IN = 12, TAPE_MAX_IN = 300;
  var LABELS = ['low', 'mid', 'top'];

  // cfg: ConfigV1 (field.ballId, field.h0, robot.shooter). rpmRange: [lo, hi] motor rpm. hoodDegs: hood angles to test.
  // opts: { engine, wheelDiameterMm | wheels }  (engine falls back to global ShotEngine)
  function plan(cfg, rpmRange, hoodDegs, opts) {
    opts = opts || {};
    var E = opts.engine || (typeof ShotEngine !== 'undefined' ? ShotEngine : null);
    if (!E) throw new Error('calib-plan: engine missing (opts.engine)');
    var lo = Number(rpmRange && rpmRange[0]), hi = Number(rpmRange && rpmRange[1]);
    if (!(lo > 0) || !(hi > lo)) throw new Error('calib-plan: rpmRange must be [lo, hi] with 0 < lo < hi');
    if (!hoodDegs || !hoodDegs.length) throw new Error('calib-plan: at least one hood angle is needed');
    hoodDegs.forEach(function (a) { if (!(a >= 5 && a <= 85)) throw new Error('calib-plan: hood angle ' + a + ' outside 5-85 deg'); });
    var ballId = (cfg && cfg.field && cfg.field.ballId) === 'nectar' ? 'nectar' : 'pollen';
    var h0 = cfg && cfg.field && cfg.field.h0 > 0 ? cfg.field.h0 : 16;
    var so = Core.shooterOf(E, cfg, opts), sh = so.sh;
    var rpms = [lo, (lo + hi) / 2, hi].map(function (r) { return Math.round(r / 10) * 10; });   // 10 rpm steps: readable on a clipboard
    var settings = [], assumptions = [];
    hoodDegs.forEach(function (deg) {
      rpms.forEach(function (rpm, i) {
        var d = Core.landingIn(E, ballId, so.S0, deg, Core.exitSpeedFromMotorRpm(rpm, sh), h0);
        var pred = isFinite(d) ? Math.round(d * 10) / 10 : null;
        var id = 'h' + deg + '-' + LABELS[i];
        settings.push({ id: id, motorRpmSet: rpm, hoodDeg: deg, ballId: ballId, h0In: h0, predictedLandingIn: pred, shots: SHOTS });
        if (pred === null) assumptions.push('Setting ' + id + ' does not reach the floor within 6 s in the model: check the angle and rpm.');
        else if (pred < TAPE_MIN_IN || pred > TAPE_MAX_IN) {
          assumptions.push('Setting ' + id + ' is predicted to land at ' + pred + ' in, outside the ' + TAPE_MIN_IN + '-' + TAPE_MAX_IN + ' in the form accepts: change the rpm range or the angle.');
        }
      });
    });
    var balls = settings.length * SHOTS;
    assumptions.unshift(
      'Actual launch angle = hood angle (no offset); the optional video step measures the real angle.',
      'Predicted distances use the current eta (' + (sh.type === 'dual' ? 'dual ' + sh.etaDual : 'single ' + sh.etaSingle) + '), the ball centre starting at the mouth height ' + h0 + ' in, ball ' + ballId + '.',
      'Landing distance = horizontal distance from the point on the floor under the shooter mouth to where the ball first touches the floor.',
      'Measure the rpm at release from encoder telemetry, not the setpoint.');
    if (so.note) assumptions.push(so.note);
    return { settings: settings, balls: balls, minutes: Math.round(8 + 0.8 * balls), assumptions: assumptions };
  }

  return { plan: plan, SHOTS: SHOTS, TAPE_MIN_IN: TAPE_MIN_IN, TAPE_MAX_IN: TAPE_MAX_IN };
});
