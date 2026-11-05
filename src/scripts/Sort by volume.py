# Lines up every top-level body and group along X, smallest volume first, centred on the X axis
# with plenty of space between them, then takes a head-on picture of each. One undo step.
# Bodies still being built are waited for; the pictures arrive as one zip download.

GAP = 150  # mm between neighbours

design = cad.list()

# Top level: not in a group, and not a tool cutting another body (those move with their owner).
objects = [(b['id'], b['name']) for b in design['bodies'] if not b['group'] and not b['owner']]
objects += [(g['id'], g['name']) for g in design['groups'] if not g['parent']]

# Measured once; a group counts as all it holds.
measured = []
for id, name in objects:
    try:
        measured.append((cad.measure(id), id, name))
    except Exception as why:  # an empty group, say: nothing to line up
        print('skipped', name, '-', why)

measured.sort(key=lambda m: m[0]['volume'])

# The row, centred on the origin along X.
total = sum(m['size'][0] for m, _, _ in measured) + GAP * max(0, len(measured) - 1)
left = -total / 2

for m, id, name in measured:
    # from its box's middle to its place in the row, on the X axis (Y = 0, Z = 0)
    target = [left + m['size'][0] / 2, 0, 0]
    cad.move([id], [target[k] - m['center'][k] for k in range(3)])
    left += m['size'][0] + GAP
    print(f"{m['volume'] / 1000:12.2f} cm³  {name}")

for k, (m, id, name) in enumerate(measured, 1):
    cad.snapshot(id, 'front', f'{k:02d} {name}')

print(len(measured), 'objects in a row,', round(total), 'mm long')
