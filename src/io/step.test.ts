import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import init from 'replicad-opencascadejs';
import { exportSTEP, importSTEP, makeBaseBox, setOC, type Shape3D } from 'replicad';
import { Box3, Matrix4, Vector3 } from 'three';
import { beforeAll, expect, it } from 'vitest';
import { ex } from '../doc/sample';
import type { Body } from '../doc/types';
import { readStep, stepObjects, stepText, type StepNode } from './step';

beforeAll(async () => setOC(await init({ wasmBinary: readFileSync(createRequire(import.meta.url).resolve('replicad-opencascadejs/wasm')) })), 60_000);

/** The body of a two-level assembly: `child` used in a parent, moved by `move`, with `unit`; both as records. */
const assembly = ({ unit = "(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))", x = '(1.,0.,0.)', twice = false, extra = '' } = {}) => `ISO-10303-21;
HEADER;
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
#1=PRODUCT('a','Top #1, with ''quote''',$,());
#2=PRODUCT_DEFINITION_FORMATION('','',#1);
#3=PRODUCT_DEFINITION('','',#2,$);
#4=PRODUCT('b','M\\X\\D85',$,());
#5=PRODUCT_DEFINITION_FORMATION('','',#4);
#6=PRODUCT_DEFINITION('','',#5,$);
#7=${unit};
#8=(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNIT_ASSIGNED_CONTEXT((#7))REPRESENTATION_CONTEXT('','3D'));
#10=SHAPE_REPRESENTATION('',(#30),#8);
#11=SHAPE_REPRESENTATION('',(#20,#31),#8);
#12=SHAPE_DEFINITION_REPRESENTATION(#13,#10);
#13=PRODUCT_DEFINITION_SHAPE('',$,#3);
#14=SHAPE_DEFINITION_REPRESENTATION(#15,#11);
#15=PRODUCT_DEFINITION_SHAPE('',$,#6);
#20=MANIFOLD_SOLID_BREP('Bolt',#21);
#21=CLOSED_SHELL('',());
#22=STYLED_ITEM('',(#23),#20);
#23=COLOUR_RGB('Glass (Clear)',1.,0.,0.);
#30=AXIS2_PLACEMENT_3D('',#32,$,$);
#31=AXIS2_PLACEMENT_3D('',#32,$,$);
#32=CARTESIAN_POINT('',(0.,0.,0.));
#33=CARTESIAN_POINT('',(0.,10.,0.));
#34=DIRECTION('',${x});
#35=DIRECTION('',(0.,0.,1.));
#36=AXIS2_PLACEMENT_3D('',#33,#35,#34);
#37=ITEM_DEFINED_TRANSFORMATION('','',#31,#36);
#38=(REPRESENTATION_RELATIONSHIP('','',#11,#10)REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#37)SHAPE_REPRESENTATION_RELATIONSHIP());
#39=NEXT_ASSEMBLY_USAGE_OCCURRENCE('1','','',#3,#6,$);
#40=PRODUCT_DEFINITION_SHAPE('',$,#39);
#41=CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#38,#40);
${twice ? "#42=NEXT_ASSEMBLY_USAGE_OCCURRENCE('2','','',#3,#6,$);\n#43=PRODUCT_DEFINITION_SHAPE('',$,#42);\n#44=CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#38,#43);" : ''}
${extra}
ENDSEC;
END-ISO-10303-21;
`;

it('reads the products, their places, names and colours', () => {
  const top = readStep(assembly())!;
  expect(top.name).toBe("Top #1, with 'quote'");
  const [child] = top.children;
  expect(child.name).toBe('MØ5');
  expect(new Vector3().setFromMatrixPosition(child.matrix).y).toBeCloseTo(10);
  expect(child.parts[0]).toMatchObject({ name: 'Bolt', color: '#ff0000', appearance: 'Glass (Clear)' });
});

it('turns a place as the file says, in the file\'s unit', () => {
  const inch = '(LENGTH_UNIT()CONVERSION_BASED_UNIT(\'INCH\',#50));\n#50=MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),#51);\n#51=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))';
  const [child] = readStep(assembly({ unit: inch, x: '(0.,1.,0.)' }))!.children;
  expect(new Vector3().setFromMatrixPosition(child.matrix).y).toBeCloseTo(254);
  expect(new Vector3(1, 0, 0).transformDirection(child.matrix).y).toBeCloseTo(1);
});

it('gives up rather than misplace: a mapped item in a shape', () => {
  expect(readStep(assembly({ extra: "#60=MAPPED_ITEM('',#61,#30);\n#61=REPRESENTATION_MAP(#30,#10);" }))).not.toBeNull(); // not in a shape: presentation only
  expect(readStep(assembly().replace("SHAPE_REPRESENTATION('',(#30),#8)", "SHAPE_REPRESENTATION('',(#30,#60),#8)").replace('ENDSEC;\nEND', "#60=MAPPED_ITEM('',#61,#30);\n#61=REPRESENTATION_MAP(#30,#10);\nENDSEC;\nEND"))).toBeNull();
});

it('decodes STEP strings', () => {
  expect(stepText("It''s \\X\\D8 \\X2\\00D800E4\\X0\\")).toBe("It's Ø Øä");
});

const objects = (root: StepNode) => {
  let n = 0;
  return stepObjects(root, 'x.step', [], (features, group) => ({ id: `b${n++}`, name: '', group, rotation: { rx: ex(0), ry: ex(0), rz: ex(0) }, color: '#123456', visible: true, position: [ex(0), ex(0), ex(0)], features, link: null }) as Body);
};

it('makes groups, bodies and one material; a product used again links', () => {
  const made = objects(readStep(assembly({ twice: true }))!);
  expect(made.groups.map((g) => g.name)).toEqual(["Top #1, with 'quote'", 'MØ5', 'MØ5 2']);
  expect(made.folded).toHaveLength(2);
  expect(made.bodies.map((b) => b.name)).toEqual(['Bolt', 'Bolt']);
  expect(made.bodies[0].features).toHaveLength(1);
  expect(made.bodies[1]).toMatchObject({ features: [], link: made.bodies[0].id });
  expect(made.materials).toHaveLength(1);
  expect(made.materials[0]).toMatchObject({ name: 'Glass (Clear)', color: '#ff0000', translucency: 0.85 });
  expect(made.bodies[1].material).toBe(made.materials[0].id);
  const place = made.groups[1].origin;
  expect(place.kind === 'custom' && place.position[1].e).toBe('10');
});

it('reads back parts cut from a file another program wrote, where they were', async () => {
  const shapes = [makeBaseBox(10, 20, 30) as Shape3D, (makeBaseBox(4, 4, 4) as Shape3D).translate(100, 0, 0)];
  const text = await exportSTEP(shapes.map((shape, i) => ({ shape, name: `Part${i}`, color: i ? '#00ff00' : '#ff0000' })), { unit: 'mm' }).text();
  const root = readStep(text)!;
  const found: { name: string; color: string | null; box: Box3 }[] = [];
  const walk = async (n: StepNode, parent: Matrix4) => {
    const world = parent.clone().multiply(n.matrix);
    for (const p of n.parts) {
      const s = (await importSTEP(new Blob([p.data]))) as Shape3D;
      const box = new Box3(new Vector3(...s.boundingBox.bounds[0]), new Vector3(...s.boundingBox.bounds[1])).applyMatrix4(world);
      found.push({ name: n.name || p.name, color: p.color, box });
      s.delete();
    }
    for (const c of n.children) await walk(c, world);
  };
  await walk(root, new Matrix4());
  expect(found).toHaveLength(2);
  const sizes = found.map((f) => f.box.getSize(new Vector3()).toArray().map((v) => +v.toFixed(3)));
  expect(sizes).toContainEqual([10, 20, 30]);
  expect(sizes).toContainEqual([4, 4, 4]);
  const small = found.find((f) => f.box.getSize(new Vector3()).x < 5)!;
  expect(small.box.getCenter(new Vector3()).x).toBeCloseTo(100);
  expect(small.color).toBe('#00ff00');
});
