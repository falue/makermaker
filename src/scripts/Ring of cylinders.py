import math

count = 8
for k in range(count):
    a = 2 * math.pi * k / count
    cad.cylinder(diameter=12, height=30, at=[60 * math.cos(a), 60 * math.sin(a), 0], name=f'Post {k + 1}')
