# Checks every body for overlaps, then for 0.5 mm of clearance, joints included over their whole way.
# cad.check needs await, because the real solids get built for it.

for clearance in (0, 0.5):
    hits = await cad.check(clearance=clearance)
    print(f'clearance {clearance} mm: {len(hits)} found')
    for h in hits:
        moving = f" ({h['joint_name']} from {h['value']})" if h['joint'] else ''
        apart = '' if h['closest'] is None else f", {h['closest']:.3f} mm apart"
        print(f"  {h['a_name']} and {h['b_name']}{moving}{apart}")
