# -*- coding: utf-8 -*-
"""
Oracle extension, entry-rule part (split seam of oracle_ext.py): does a rect hit satisfy an entry rule?

  rule_pass(rule, rect_hit, entry_angle_deg, entry_speed) -> bool
  rule = {"rule": "any"} | {"rule": "descending"} | {"rule": "maxSpeed", "maxSpeedMps": m/s}   (same shape as the engine's params.entry)
  any: every rect hit; descending: rect hit with entry angle < 0 (velocity pointing down at the mouth-plane crossing);
  maxSpeed: rect hit with entry speed <= maxSpeedMps. A shot that is not a rect hit never passes. Unknown rules raise ValueError
  (the engine silently falls back to "any"; the oracle should not hide a typo).
oracle_ext.py attaches the outcome to its results: case["entry_rules"] = [rule, ...] -> result["entry_pass"] = [bool, ...].
"""


def rule_pass(rule, rect_hit, angle_deg, speed):
    kind = (rule or {}).get('rule', 'any')
    if kind not in ('any', 'descending', 'maxSpeed'):
        raise ValueError('unknown entry rule %r' % (rule,))
    if not rect_hit:
        return False
    if kind == 'descending':
        return bool(angle_deg < 0)
    return True if kind == 'any' else bool(speed <= float(rule['maxSpeedMps']))
