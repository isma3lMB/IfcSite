import { describe, expect, it } from 'vitest';
import { duplicateBuilding, duplicateTree } from '@/lib/scene/duplicate';
import type { Building, Tree } from '@/lib/types';

/** A 10 x 4 footprint on its own centroid, tinted and moved, as a copied
 *  building would actually be found: mid-edit rather than fresh. */
const source = (): Building => ({
  id: 'way/123',
  name: 'Building 12',
  props: { osm_id: 'way/123', Source: 'osm' },
  ring: [
    [-5, -2],
    [5, -2],
    [5, 2],
    [-5, 2],
  ],
  center: [100, 200],
  h: 9,
  baseZ: 3,
  src: 'tag:height',
  xf: { pos: [1, 2, 3], rot: [0, 0, 0.5], scale: [1, 1, 1], color: 0x336699, opacity: 0.4 },
});

const sourceTree = (): Tree => ({
  id: 'osm-node/7',
  name: 'Tree 3',
  props: { species: 'Tilia' },
  x: 10,
  y: 20,
  z: 1,
  h: 8,
  cr: 2.5,
  tr: 0.15,
  src: 'osm',
  xf: { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], color: null, opacity: 1 },
});

describe('duplicateBuilding', () => {
  it('takes the new id and name, and nothing else about the shape changes', () => {
    const b = source();
    const c = duplicateBuilding(b, 'drawn-4', 'Building 12 (copy)');
    expect(c.id).toBe('drawn-4');
    expect(c.name).toBe('Building 12 (copy)');
    expect(c.center).toEqual(b.center);
    expect(c.ring).toEqual(b.ring);
    expect(c.h).toBe(b.h);
    expect(c.baseZ).toBe(b.baseZ);
  });

  it('lands exactly where the original stands', () => {
    const c = duplicateBuilding(source(), 'drawn-4', 'copy');
    expect(c.xf.pos).toEqual([1, 2, 3]);
  });

  it('is hand-made work, whatever it was copied from', () => {
    const c = duplicateBuilding(source(), 'drawn-4', 'copy');
    expect(c.src).toBe('user');
    expect(c.props.Source).toBe('drawn');
    // The provenance of the original is kept as the only trace of where it came from.
    expect(c.props.osm_id).toBe('way/123');
  });

  it('carries the colour, opacity and rotation the original had', () => {
    const c = duplicateBuilding(source(), 'drawn-4', 'copy');
    expect(c.xf.color).toBe(0x336699);
    expect(c.xf.opacity).toBe(0.4);
    expect(c.xf.rot).toEqual([0, 0, 0.5]);
  });

  it('shares nothing mutable with the original', () => {
    const b = source();
    const c = duplicateBuilding(b, 'drawn-4', 'copy');
    c.ring[0][0] = 999;
    c.center[0] = 999;
    c.props.Extra = 'x';
    c.xf.rot[2] = 999;
    expect(b.ring[0][0]).toBe(-5);
    expect(b.center[0]).toBe(100);
    expect(b.props.Extra).toBeUndefined();
    expect(b.xf.rot[2]).toBe(0.5);
  });
});

describe('duplicateTree', () => {
  it('lands on the original, keeping the plant point and the dimensions', () => {
    const t = sourceTree();
    const c = duplicateTree(t, 'drawn-tree-1', 'Tree 3 (copy)');
    expect(c.id).toBe('drawn-tree-1');
    expect(c.xf.pos).toEqual([0, 0, 0]);
    expect([c.x, c.y, c.z]).toEqual([10, 20, 1]);
    expect([c.h, c.cr, c.tr]).toEqual([8, 2.5, 0.15]);
    expect(c.src).toBe('user');
  });

  it('shares nothing mutable with the original', () => {
    const t = sourceTree();
    const c = duplicateTree(t, 'drawn-tree-1', 'copy');
    c.xf.scale[0] = 999;
    c.props.species = 'Acer';
    expect(t.xf.scale[0]).toBe(1);
    expect(t.props.species).toBe('Tilia');
  });
});
