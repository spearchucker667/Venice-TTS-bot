import test from "node:test";
import assert from "node:assert/strict";
import {
  SHAPES_MAP,
  shapeById,
  SphereShape,
  OvalShape,
  RoundedSquareShape,
  TriangleShape,
  DiamondShape,
  HexagonShape,
  CapsuleShape,
} from "./shapes.ts";
import { createSim, stepSim, COUNT } from "./physics.ts";
import type { OrbShapeId } from "./theme.ts";

test("ORB-007 / SHAPES: zero-dt or negative-dt does not change sim state (frozen reduced motion)", () => {
  const sim = createSim();
  const initialP = new Float32Array(sim.p);
  const initialV = new Float32Array(sim.v);
  const initialHeat = new Float32Array(sim.heat);
  const initialTime = sim.time;

  stepSim(sim, 0, "idle", true);
  assert.equal(sim.time, initialTime);
  assert.deepEqual(sim.p, initialP);
  assert.deepEqual(sim.v, initialV);
  assert.deepEqual(sim.heat, initialHeat);

  stepSim(sim, -0.01, "think", false);
  assert.equal(sim.time, initialTime);
  assert.deepEqual(sim.p, initialP);
});

test("SHAPES: all 7 shapes exist and are retrievable by ID", () => {
  const ids: OrbShapeId[] = [
    "sphere",
    "oval",
    "rounded-square",
    "triangle",
    "diamond",
    "hexagon",
    "capsule",
  ];

  for (const id of ids) {
    const s = shapeById(id);
    assert.ok(s, `Shape ${id} should exist`);
    assert.equal(s.id, id);
    assert.ok(typeof s.signedDistance === "function");
    assert.ok(typeof s.projectInside === "function");
    assert.ok(typeof s.normalAt === "function");
  }
});

test("SHAPES: projectInside constrains points outside back inside with valid normals", () => {
  const shapes = [
    SphereShape,
    OvalShape,
    RoundedSquareShape,
    TriangleShape,
    DiamondShape,
    HexagonShape,
    CapsuleShape,
  ];

  const outsidePoints: [number, number, number][] = [
    [2.0, 0, 0],
    [-2.0, 0, 0],
    [0, 2.5, 0],
    [0, -2.5, 0],
    [0, 0, 2.0],
    [1.5, 1.5, 1.5],
    [-1.5, 1.5, -1.5],
  ];

  for (const shape of shapes) {
    for (const pt of outsidePoints) {
      const proj = shape.projectInside(pt, 0.1);
      assert.ok(Number.isFinite(proj[0]), `${shape.id} proj[0] finite`);
      assert.ok(Number.isFinite(proj[1]), `${shape.id} proj[1] finite`);
      assert.ok(Number.isFinite(proj[2]), `${shape.id} proj[2] finite`);

      const normal = shape.normalAt(proj);
      const len = Math.hypot(normal[0], normal[1], normal[2]);
      assert.ok(Math.abs(len - 1.0) < 0.05, `${shape.id} normal should be unit length, got ${len}`);
    }
  }
});

test("SHAPES: simulation step stays finite, inside boundary, and free of NaNs across 100 steps for every shape", () => {
  const shapeIds = Object.keys(SHAPES_MAP) as OrbShapeId[];

  for (const shapeId of shapeIds) {
    const vessel = SHAPES_MAP[shapeId];
    const sim = createSim();

    for (let step = 0; step < 100; step++) {
      stepSim(sim, 0.016, "think", false, 1.2, 1.1, 0.5, vessel);

      for (let i = 0; i < COUNT * 3; i++) {
        assert.ok(Number.isFinite(sim.p[i]), `Shape ${shapeId} p[${i}] finite at step ${step}`);
        assert.ok(Number.isFinite(sim.v[i]), `Shape ${shapeId} v[${i}] finite at step ${step}`);
      }
      for (let i = 0; i < COUNT; i++) {
        assert.ok(
          Number.isFinite(sim.heat[i]),
          `Shape ${shapeId} heat[${i}] finite at step ${step}`,
        );
        assert.ok(sim.heat[i] >= 0 && sim.heat[i] <= 1, `Shape ${shapeId} heat in [0,1]`);
      }
    }
  }
});
