# A small shelf with posts, built with the `cad` module. Runs as one undo step.
# cad.commands() lists every command, help(cad.box) tells about one.
import math

# A parameter: everything using it follows when it changes in the Parameters list.
cad.parameter('$wall', '4')

# The plate: a formula stays a formula.
length, width = 160, 90
plate = cad.box(length, width, '$wall', radius=6, name='Plate')

# Four posts under it; plain numbers are millimetres.
for k, (x, y) in enumerate([(-1, -1), (1, -1), (1, 1), (-1, 1)]):
    cad.cylinder(diameter=10, height=60, at=[x * (length / 2 - 14), y * (width / 2 - 14), -60], name=f'Post {k + 1}')

# A ring of pegs on top.
count = 8
pegs = []
for k in range(count):
    a = 2 * math.pi * k / count
    pegs.append(cad.cylinder(diameter=6, height=12, at=[28 * math.cos(a), 28 * math.sin(a), 4], name=f'Peg {k + 1}'))

# A sketch to draw on by hand afterwards, with a closed outline in it.
sketch = cad.sketch('xy', offset=20, name='Outline')
cad.polygon(sketch, [[-50, -30], [50, -30], [50, 30], [-50, 30]])

# What came out, and what stays selected.
design = cad.list()  adasdasd
print(len(design['bodies']), 'bodies,', len(design['sketches']), 'sketches')
cad.select(plate, *pegs)
print('selected', len(cad.selection()))
