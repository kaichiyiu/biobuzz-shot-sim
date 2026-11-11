/* BIOBUZZ Shot Sim - #11 live checks of one calibration row (plausible ranges, setpoint vs measured rpm, unit mix-ups).
   Row values are canonical (landing and height in INCHES, as CalibRow); ctx.units is what the team types in ('imperial' in /
   'metric' cm, the form converts before calling) and only selects the wording and the unit-mismatch hints.
   validateRow(row, { setpointRpm?, units }) -> [{ field, level: 'error' | 'warn', text }]  (empty = fine).
   Browser: window.CalibValidate. Node: module.exports. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CalibValidate = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var LAND_MIN = 12, LAND_MAX = 300, RPM_TOL = 0.10, RPM_HIGH = 6500, RPM_LOW = 300, CM = 2.54;

  function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }), n = s.length; return n % 2 ? s[(n - 1) / 2] : 0.5 * (s[n / 2 - 1] + s[n / 2]); }

  function validateRow(row, ctx) {
    ctx = ctx || {};
    var metric = ctx.units === 'metric', out = [];
    function add(field, level, text) { out.push({ field: field, level: level, text: text }); }
    function len(inches) { return metric ? Math.round(inches * CM * 10) / 10 + ' cm' : Math.round(inches * 10) / 10 + ' in'; }
    var unit = metric ? 'centimetres' : 'inches', lo = len(LAND_MIN), hi = len(LAND_MAX);
    row = row || {};

    if (row.ballId !== 'pollen' && row.ballId !== 'nectar') add('ballId', 'error', 'Ball must be POLLEN or NECTAR.');
    if (!isFinite(row.h0In) || row.h0In == null) add('h0In', 'error', 'Mouth height is missing or not a number.');
    else if (row.h0In < 4 || row.h0In > 29) add('h0In', 'warn', 'Mouth height ' + len(row.h0In) + ' is unusual (expected ' + len(4) + ' to ' + len(29) + '): is it measured from the floor to the ball centre at release?');
    if (!isFinite(row.hoodDeg) || row.hoodDeg == null) add('hoodDeg', 'error', 'Hood angle is missing or not a number.');
    else if (row.hoodDeg < 5 || row.hoodDeg > 85) add('hoodDeg', 'error', 'Hood angle ' + row.hoodDeg + ' deg is outside 5 to 85 deg (measured from horizontal).');

    var m = row.measuredMotorRpm;
    if (!(m > 0) || !isFinite(m)) add('measuredMotorRpm', 'error', 'Measured rpm is missing or not a positive number.');
    else {
      if (m > RPM_HIGH) add('measuredMotorRpm', 'warn', 'Measured ' + Math.round(m) + ' rpm is above the free speed of any goBILDA motor (6000 rpm): is this motor rpm, not ticks per second or wheel rpm?');
      else if (m < RPM_LOW) add('measuredMotorRpm', 'warn', 'Measured ' + Math.round(m) + ' rpm is very low for a shot: check the unit (rpm, not rps).');
      var sp = ctx.setpointRpm;
      if (sp > 0 && Math.abs(m - sp) / sp > RPM_TOL) {
        add('measuredMotorRpm', 'warn', 'Measured ' + Math.round(m) + ' rpm is ' + Math.round(100 * Math.abs(m - sp) / sp) + ' % from the setpoint ' + Math.round(sp) + ' rpm: use the encoder reading at release, and check the flywheel reached its speed.');
      }
    }

    var d = row.landingIn;
    if (!Array.isArray(d) || !d.length) add('landingIn', 'error', 'Enter the landing distance of each shot.');
    else {
      var ok = [];
      d.forEach(function (x, i) {
        if (!isFinite(x) || x == null) add('landingIn[' + i + ']', 'error', 'Shot ' + (i + 1) + ': landing distance is missing or not a number.');
        else if (x < LAND_MIN || x > LAND_MAX) add('landingIn[' + i + ']', 'error', 'Shot ' + (i + 1) + ': ' + len(x) + ' is outside the ' + lo + ' to ' + hi + ' this test accepts.');
        else ok.push(x);
      });
      if (d.length < 5) add('landingIn', 'warn', d.length + ' shot(s) entered; the plan uses 5 per setting so the spread can be estimated.');
      var fin = d.filter(function (x) { return isFinite(x) && x != null; });
      if (fin.length) {
        var med = median(fin);
        // unit mix-up hints: the whole row is off in the same direction
        if (med < LAND_MIN) add('landingIn', 'warn', 'These distances look like ' + (metric ? 'metres' : 'metres or feet') + ' (typical ' + len(med) + '): this field expects ' + unit + ' from the point under the mouth.');
        else if (med > LAND_MAX) add('landingIn', 'warn', 'These distances look like ' + (metric ? 'millimetres' : 'centimetres or millimetres') + ' (typical ' + len(med) + '): this field expects ' + unit + '.');
        else if (ok.length >= 3 && (Math.max.apply(null, ok) - Math.min.apply(null, ok)) / med > 0.5) {
          add('landingIn', 'warn', 'The shots differ by more than half of the typical distance: check for a mistyped value.');
        }
      }
    }
    return out;
  }

  return { validateRow: validateRow, LAND_MIN: LAND_MIN, LAND_MAX: LAND_MAX, RPM_TOL: RPM_TOL };
});
