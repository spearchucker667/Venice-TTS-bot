import type { Mood } from "./state.ts";
import { SphereShape, type VesselShape } from "./shapes.ts";

export const COUNT = 8;
export const VESSEL = 0.74;

export type Sim = {
  p: Float32Array;
  v: Float32Array;
  heat: Float32Array;
  rad: Float32Array;
  time: number;
};

export function createSim(): Sim {
  const p = new Float32Array(COUNT * 3);
  const v = new Float32Array(COUNT * 3);
  const heat = new Float32Array(COUNT);
  const rad = new Float32Array([0.3, 0.16, 0.26, 0.14, 0.24, 0.13, 0.2, 0.15]);
  for (let i = 0; i < COUNT; i++) {
    const a = (i / COUNT) * Math.PI * 2;
    const ring = 0.05 + (i % 3) * 0.08;
    p[i * 3] = Math.cos(a) * ring;
    p[i * 3 + 1] = -0.52 + (i % 8) * 0.13;
    p[i * 3 + 2] = Math.sin(a) * ring * 0.8;
    heat[i] = i % 2 === 0 ? 0.78 : 0.22;
  }
  return { p, v, heat, rad, time: 0 };
}

function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n));
}

/** CPU motion for blob centers only: buoyancy, vessel keep-out, soft repulsion. */
export function stepSim(
  sim: Sim,
  dt: number,
  mood: Mood,
  reduced: boolean,
  motionScale = 1,
  buoyScale = 1,
  pull = 0,
  vessel: VesselShape = SphereShape,
): void {
  // ORB-007: If dt <= 0 (e.g. static/frozen reduced motion), do not advance sim time, heat, or positions
  if (dt <= 0) {
    return;
  }

  const step = clamp(dt, 0.001, 0.033);
  const motion = (reduced ? 0.12 : 1) * motionScale;
  sim.time += step * (reduced ? 0.35 : 1) * (0.65 + motionScale * 0.35);
  const t = sim.time;
  const { p, v, heat, rad } = sim;
  const error = mood === "error";
  const listen = mood === "listen";
  const think = mood === "think";

  for (let i = 0; i < COUNT; i++) {
    const o = i * 3;
    const yNorm = p[o + 1] / VESSEL;
    const heatRate = error ? -0.8 : 0.42 * motion;
    heat[i] = clamp(heat[i] + -yNorm * heatRate * step, 0, 1);
    const buoy = error ? -1.35 : (heat[i] - 0.4) * 3.1 * motion * buoyScale;
    v[o + 1] += buoy * step;
    if (!reduced) {
      const wander = (think ? 1.7 : listen ? 0.25 : 0.55) * motionScale;
      v[o] += Math.sin(t * 0.85 + i * 1.7) * wander * step;
      v[o + 2] += Math.cos(t * 0.73 + i * 1.3) * wander * step;
    }
    if (pull > 0) {
      v[o] += -p[o] * pull * step;
      v[o + 1] += -p[o + 1] * pull * 0.55 * step;
      v[o + 2] += -p[o + 2] * pull * step;
    }
    if (think && !reduced) {
      v[o] += Math.sin(t * 3.1 + i) * 1.5 * step;
      v[o + 2] += Math.cos(t * 2.6 + i * 1.8) * 1.5 * step;
      v[o + 1] += Math.sin(t * 4.0 + i * 0.6) * 0.45 * step;
    }
    if (listen) {
      v[o] += -p[o] * 1.5 * step;
      v[o + 1] += -p[o + 1] * 1.15 * step;
      v[o + 2] += -p[o + 2] * 1.5 * step;
    }
    const damp = Math.exp((error ? -2.4 : -0.48) * step);
    v[o] *= damp;
    v[o + 1] *= damp;
    v[o + 2] *= damp;
    const sp = Math.hypot(v[o], v[o + 1], v[o + 2]);
    const maxSp = error ? 0.35 : 1.15;
    if (sp > maxSp) {
      const k = maxSp / sp;
      v[o] *= k;
      v[o + 1] *= k;
      v[o + 2] *= k;
    }
    p[o] += v[o] * step;
    p[o + 1] += v[o + 1] * step;
    p[o + 2] += v[o + 2] * step;
  }

  for (let i = 0; i < COUNT; i++) {
    for (let j = i + 1; j < COUNT; j++) {
      const a = i * 3;
      const b = j * 3;
      let dx = p[a] - p[b];
      let dy = p[a + 1] - p[b + 1];
      let dz = p[a + 2] - p[b + 2];
      const dist = Math.hypot(dx, dy, dz) || 1e-4;
      const minD = (rad[i] + rad[j]) * (listen ? 0.62 : 0.36);
      if (dist < minD) {
        const push = (minD - dist) * 0.32;
        const inv = 1 / dist;
        dx *= inv * push;
        dy *= inv * push;
        dz *= inv * push;
        p[a] += dx;
        p[a + 1] += dy;
        p[a + 2] += dz;
        p[b] -= dx;
        p[b + 1] -= dy;
        p[b + 2] -= dz;
      }
    }
  }

  // Vessel boundary confinement using VesselShape
  for (let i = 0; i < COUNT; i++) {
    const o = i * 3;
    const margin = rad[i] * 0.55;
    const current: [number, number, number] = [p[o] ?? 0, p[o + 1] ?? 0, p[o + 2] ?? 0];
    const projected = vessel.projectInside(current, margin);
    const moved =
      Math.abs(current[0] - projected[0]) > 1e-5 ||
      Math.abs(current[1] - projected[1]) > 1e-5 ||
      Math.abs(current[2] - projected[2]) > 1e-5;

    p[o] = projected[0];
    p[o + 1] = projected[1];
    p[o + 2] = projected[2];

    if (moved) {
      const n = vessel.normalAt([p[o] ?? 0, p[o + 1] ?? 0, p[o + 2] ?? 0]);
      const vn = (v[o] ?? 0) * n[0] + (v[o + 1] ?? 0) * n[1] + (v[o + 2] ?? 0) * n[2];
      if (vn > 0) {
        v[o] = (v[o] ?? 0) - vn * n[0];
        v[o + 1] = (v[o + 1] ?? 0) - vn * n[1];
        v[o + 2] = (v[o + 2] ?? 0) - vn * n[2];
      }
    }
  }
}

export function displayRadius(base: number, mood: Mood, level: number): number {
  if (mood === "listen") return base * (0.7 + level * 0.1);
  if (mood === "error") return base * 0.5;
  if (mood === "speak") return base * (1 + Math.min(1, level) * 0.16);
  if (mood === "think") return base * 1.04;
  if (mood === "tool") return base * 0.92;
  return base;
}
