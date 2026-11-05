# five boxes, each taller
for k in range(5):
    cad.box(20, 20, 10 + k * 10, at=[k * 30, 0, 0], name=f'Box {k + 1}')
