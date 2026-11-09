import * as THREE from 'three';
import { expect, it } from 'vitest';
import { exploded, explodeDepth, type ExplodeNode } from './explode';

const box = (x0: number, x1: number) => new THREE.Box3(new THREE.Vector3(x0, 0, 0), new THREE.Vector3(x1, 1, 1));
const leaf = (id: string): ExplodeNode => ({ turn: new THREE.Quaternion(), children: [], bodies: [id] });
const node = (...children: ExplodeNode[]): ExplodeNode => ({ turn: new THREE.Quaternion(), children, bodies: [] });

it('lines the top level up along the axis with gaps, the middle staying', () => {
  // two overlapping boxes 10 wide: fully exploded they sit 5 apart (half their mean size), around the old middle
  const boxes: Record<string, THREE.Box3> = { a: box(0, 10), b: box(2, 12) };
  const shifts = exploded(node(leaf('a'), leaf('b')), (id) => boxes[id], [1, 0, 0], 1);
  expect(shifts.get('a')!.x).toBeCloseTo(-6.5);
  expect(shifts.get('b')!.x).toBeCloseTo(6.5);
  expect(exploded(node(leaf('a'), leaf('b')), (id) => boxes[id], [0.5, 0, 0], 1).get('b')!.x).toBeCloseTo(3.25);
});

it('a group moves as one at depth 1, spreads inside at depth 2', () => {
  const boxes: Record<string, THREE.Box3> = { a: box(0, 10), b: box(0, 10), c: box(0, 10) };
  const root = node(node(leaf('a'), leaf('b')), leaf('c'));
  expect(explodeDepth(root)).toBe(2);
  const flat = exploded(root, (id) => boxes[id], [1, 0, 0], 1);
  expect(flat.get('a')!.x).toBeCloseTo(flat.get('b')!.x);
  const deep = exploded(root, (id) => boxes[id], [1, 0, 0], 2);
  expect(deep.get('b')!.x - deep.get('a')!.x).toBeCloseTo(15);
});

it('a turned group spreads along its own axis', () => {
  const boxes: Record<string, THREE.Box3> = { a: box(0, 10), b: box(0, 10) };
  const turned = { ...node(leaf('a'), leaf('b')), turn: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2) };
  const shifts = exploded(node(turned), (id) => boxes[id], [1, 0, 0], 2);
  expect(Math.abs(shifts.get('a')!.x)).toBeLessThan(1e-9);
  expect(Math.abs(shifts.get('a')!.y)).toBeGreaterThan(0);
});
