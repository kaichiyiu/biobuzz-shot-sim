# Calibrating eta with landing-distance tests

The simulator turns a launch speed into a motor rpm with one number, **eta**: ball exit speed divided by the wheel's surface speed (single wheel) or by the average surface speed (dual wheel). The default (0.45 single, 0.90 dual) is a theory value. A real shooter is usually lower: slip and compression of the ball cost speed, and every rpm the tool shows is off by the same ratio. Calibration finds your own value from a few shots.

You do not compute anything. The tool plans the test, you enter what you measured, and it fits eta by running its own flight model (drag and spin included) backwards from each landing distance.

Status: trial. Tell us what was confusing after your first session.

## What you need

- Your shooter, set up as in the simulator (wheel, gearing, hood angle, ball type, mouth height). Change the simulator's Robot config first if it does not match.
- About 15 balls of one type and 20 minutes.
- A flat floor clear of obstacles, a tape measure, masking tape and a marker. Open the simulator on a laptop or phone next to the shooter.
- A way to read the **motor encoder rpm at the moment of release** (telemetry, a logged value or a printout). The setpoint is not good enough: the flywheel dips and may not reach it.
- Optional: a phone that films in slow motion (120 or 240 frames per second) and a ruler, for the launch-angle step.

## 1. Set up and tape the floor

1. Set the hood. For a fixed hood the simulator uses the angle you entered; for an adjustable hood it uses the currently recommended angle. Check the **Hood angles** box in the calibration card (you can type several, separated by commas) and fix the hood at each angle you test. Measure the angle from horizontal.
2. Check the **mouth height**: floor to the centre of the ball as it leaves the shooter. It is the "Mouth height" in Robot config.
3. The card suggests a rpm range from your current shot (current rpm plus and minus 15 %, or the export range when the export card has one). Adjust it if you shoot elsewhere, then press **Make test plan**.
4. The plan lists three settings (low, mid, top rpm) per hood angle, with the **predicted landing distance** of each. Tape a mark at each predicted distance, measured along the shot line from the point on the floor directly under the shooter mouth. If a ball lands far from its mark, something in the setup is wrong (hood angle, mouth height, wrong ball); fix that before you collect data.

## 2. Shoot and enter the data

For each setting, shoot **5 balls**:

1. Command the setpoint shown in the table.
2. For every shot, note the **encoder rpm at release** (one value per setting is enough: enter the typical one) and where the ball **first touched the floor**, as a distance from the same zero point. Use a tape measure, not the tape marks. Enter each shot individually. Do not average them.
3. Type the values into the table. Distances use the units shown in the column headings (the metric / imperial switch at the top changes them).

The tool checks as you type. It warns when the measured rpm is more than 10 % from the setpoint (flywheel not at speed, or the wrong reading), when a distance is outside 12 to 300 inches (likely a unit mix-up), and when the shots of one setting are very scattered. Fix the cell or reshoot that setting. **Fit eta** unlocks when there are at least 5 valid shots and no errors.

## 3. Optional: measure the real launch angle from video

The fit assumes the ball leaves at the hood angle. Hoods flex and balls leave a little off the hood line, so this is the weakest assumption. To measure it:

1. Film one shot from the side, camera level and still, with a ruler in the plane of the shot. Note the frame rate.
2. Find two frames a few frames apart, shortly after the ball leaves the mouth. In the card's "Optional: measure the real launch angle" section enter the ball centre in each frame (x along the shot, y up, read off the ruler), the frame rate and the number of frames between them.
3. **Measure angle** shows the launch angle and the offset from the hood angle. The fit then uses the offset, and the report says so. Without the step the report states that actual angle = hood angle was assumed.

## 4. Read the report and apply

Press **Fit eta**. The report shows:

- the fitted eta and the exit-speed factor it comes from,
- each setting: measured mean landing distance, the distance predicted with the fitted eta, the residual, the shot spread,
- **repeat this one** next to settings with an outlier shot or a spread far larger than the others. Reshoot that setting and fit again,
- the shot-to-shot spread as an effective **plus or minus rpm**, a number for how precisely your flywheel repeats.

**Single eta** fits one value (the default and usually best with 15 shots). **Per-rpm** fits a value for each tested rpm and interpolates; the live simulator still uses one eta (the value at the middle of your range), and only the report and the export convert speed to rpm along the curve. Use it only when the residuals show a clear trend with rpm.

**Apply eta** writes the value into the simulator (the eta slider, which may then sit outside its usual 0.30 to 0.50 range), recalculates every rpm and saves the calibration (value, date and your raw data) with your configuration. The eta control shows **calibrated** with the date. Moving the slider afterwards makes it a manual value again. **Clear calibration** removes the record and keeps the current value.

## 5. Check it: the scoring bracket at a HIVE

A last check that does not need landing marks:

1. Pick a spot from which the simulator says the shot scores, and note its lowest and highest scoring rpm ("RPM vs distance" for a fixed hood, or the rpm window for an adjustable hood).
2. Place the robot there, aimed as advised. Shoot at a rpm just inside the low end and another just inside the high end (use the encoder rpm, as above).
3. Most balls should score at both. A shot that falls short at the low end means eta is too high; one that flies over at the high end means it is too low. Repeat the calibration, perhaps with more settings, if the bracket is off by more than a few percent.

## 6. CSV for robot logging

**Export CSV** writes the table and **Import CSV** reads it back, so robot code can log rows directly. One line per shot, header row first:

```
settingId,ballId,h0In,hoodDeg,measuredMotorRpm,landingIn
h68.3-low,pollen,16,68.3,1860,22.5
h68.3-low,pollen,16,68.3,1860,23.2
```

- `settingId` groups the shots of one setting (if you leave it blank, consecutive identical settings are grouped).
- `ballId` is `pollen` or `nectar`. `h0In` is the mouth height and `landingIn` the landing distance, **always in inches** in the file, whatever the display units are. `hoodDeg` is in degrees and `measuredMotorRpm` is the motor rpm.
- Columns may be in any order. A bad header or an unreadable line is reported with its line number and nothing is imported silently.

## Limits

- Only eta is fitted. Drag and lift coefficients are not.
- The fit is only as good as the measurements: an error of 2 in on a 150 in shot is about 1 % in eta; a wrong mouth height or hood angle shifts it more.
- Different balls, wheels, battery levels or compression change eta. Calibrate again after a hardware change.
