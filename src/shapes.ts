/**
 * Vessel Shapes for Ember Animated Orb Engine
 * Defines geometric signed distance fields, boundary projection, surface normals,
 * and ray intersections for 7 animated vessel forms.
 */

import type { OrbShapeId } from "./theme.ts";

export type Vec3 = [number, number, number];

export interface VesselShape {
  id: OrbShapeId;
  name: string;
  signedDistance(p: Vec3): number;
  projectInside(p: Vec3, margin: number): Vec3;
  normalAt(p: Vec3): Vec3;
}

const VESSEL_BASE = 0.74;

function length3(x: number, y: number, z: number): number {
  return Math.hypot(x, y, z) || 1e-6;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// 1. Sphere
export const SphereShape: VesselShape = {
  id: "sphere",
  name: "Sphere",
  signedDistance([x, y, z]: Vec3): number {
    return length3(x, y, z) - VESSEL_BASE;
  },
  projectInside([x, y, z]: Vec3, margin: number): Vec3 {
    const limit = Math.max(0.08, VESSEL_BASE - margin);
    const len = length3(x, y, z);
    if (len > limit) {
      const s = limit / len;
      return [x * s, y * s, z * s];
    }
    return [x, y, z];
  },
  normalAt([x, y, z]: Vec3): Vec3 {
    const len = length3(x, y, z);
    return [x / len, y / len, z / len];
  },
};

// 2. Oval (Ellipsoid: wide horizontally, compressed vertically)
const OVAL_AXES: Vec3 = [0.82, 0.62, 0.72];
export const OvalShape: VesselShape = {
  id: "oval",
  name: "Oval",
  signedDistance([x, y, z]: Vec3): number {
    const k = length3(x / OVAL_AXES[0], y / OVAL_AXES[1], z / OVAL_AXES[2]);
    return (k - 1.0) * Math.min(OVAL_AXES[0], OVAL_AXES[1], OVAL_AXES[2]);
  },
  projectInside([x, y, z]: Vec3, margin: number): Vec3 {
    const rx = Math.max(0.1, OVAL_AXES[0] - margin);
    const ry = Math.max(0.1, OVAL_AXES[1] - margin);
    const rz = Math.max(0.1, OVAL_AXES[2] - margin);
    const k = length3(x / rx, y / ry, z / rz);
    if (k > 1.0) {
      return [x / k, y / k, z / k];
    }
    return [x, y, z];
  },
  normalAt([x, y, z]: Vec3): Vec3 {
    const nx = x / (OVAL_AXES[0] * OVAL_AXES[0]);
    const ny = y / (OVAL_AXES[1] * OVAL_AXES[1]);
    const nz = z / (OVAL_AXES[2] * OVAL_AXES[2]);
    const len = length3(nx, ny, nz);
    return [nx / len, ny / len, nz / len];
  },
};

// 3. Rounded Square (Rounded Box with spherical depth)
const BOX_HALF = 0.48;
const BOX_ROUND = 0.22;
export const RoundedSquareShape: VesselShape = {
  id: "rounded-square",
  name: "Square",
  signedDistance([x, y, z]: Vec3): number {
    const dx = Math.abs(x) - BOX_HALF;
    const dy = Math.abs(y) - BOX_HALF;
    const dz = Math.abs(z) - BOX_HALF;
    const ox = Math.max(dx, 0);
    const oy = Math.max(dy, 0);
    const oz = Math.max(dz, 0);
    const outside = length3(ox, oy, oz);
    const inside = Math.min(Math.max(dx, dy, dz), 0);
    return outside + inside - BOX_ROUND;
  },
  projectInside([x, y, z]: Vec3, margin: number): Vec3 {
    const maxB = BOX_HALF + BOX_ROUND - margin;
    const px = clamp(x, -maxB, maxB);
    const py = clamp(y, -maxB, maxB);
    const pz = clamp(z, -maxB, maxB);
    // Smooth corners
    const dx = Math.abs(px) - BOX_HALF;
    const dy = Math.abs(py) - BOX_HALF;
    const _dz = Math.abs(pz) - BOX_HALF;
    if (dx > 0 && dy > 0) {
      const len = Math.hypot(dx, dy);
      const maxR = Math.max(0.05, BOX_ROUND - margin);
      if (len > maxR) {
        const factor = maxR / len;
        return [
          Math.sign(px) * (BOX_HALF + dx * factor),
          Math.sign(py) * (BOX_HALF + dy * factor),
          pz,
        ];
      }
    }
    return [px, py, pz];
  },
  normalAt([x, y, z]: Vec3): Vec3 {
    const eps = 0.001;
    const d = this.signedDistance([x, y, z]);
    const nx = this.signedDistance([x + eps, y, z]) - d;
    const ny = this.signedDistance([x, y + eps, z]) - d;
    const nz = this.signedDistance([x, y, z + eps]) - d;
    const len = length3(nx, ny, nz);
    return [nx / len, ny / len, nz / len];
  },
};

// 4. Triangle (Rounded Equilateral Triangle Prism)
const TRI_R = 0.65;
export const TriangleShape: VesselShape = {
  id: "triangle",
  name: "Triangle",
  signedDistance([x, y, z]: Vec3): number {
    // 2D equilateral triangle SDF
    const k = Math.sqrt(3.0);
    let px = Math.abs(x) - TRI_R;
    let py = y + TRI_R / k;
    if (px + k * py > 0.0) {
      const nx = (px - k * py) / 2.0;
      const ny = (-k * px - py) / 2.0;
      px = nx;
      py = ny;
    }
    px -= clamp(px, -2.0 * TRI_R, 0.0);
    const d2 = -length3(px, py, 0) * Math.sign(py);
    const dz = Math.abs(z) - 0.55;
    return Math.max(d2 - 0.1, dz);
  },
  projectInside([x, y, z]: Vec3, margin: number): Vec3 {
    const pz = clamp(z, -(0.55 - margin), 0.55 - margin);
    // Project inside triangle bounds
    const topY = 0.62 - margin;
    const botY = -0.52 + margin;
    const py = clamp(y, botY, topY);
    // Slope: |x| <= (topY - y) * 0.72
    const maxHalfW = Math.max(0.05, (0.68 - margin - py) * 0.75);
    const px = clamp(x, -maxHalfW, maxHalfW);
    return [px, py, pz];
  },
  normalAt([x, y, z]: Vec3): Vec3 {
    const eps = 0.001;
    const d = this.signedDistance([x, y, z]);
    const nx = this.signedDistance([x + eps, y, z]) - d;
    const ny = this.signedDistance([x, y + eps, z]) - d;
    const nz = this.signedDistance([x, y, z + eps]) - d;
    const len = length3(nx, ny, nz);
    return [nx / len, ny / len, nz / len];
  },
};

// 5. Diamond (Rotated Square / Rhombus)
const DIAMOND_RADIUS = 0.68;
export const DiamondShape: VesselShape = {
  id: "diamond",
  name: "Diamond",
  signedDistance([x, y, z]: Vec3): number {
    const d2 = (Math.abs(x) + Math.abs(y) - DIAMOND_RADIUS) * 0.7071;
    const dz = Math.abs(z) - 0.55;
    return Math.max(d2, dz);
  },
  projectInside([x, y, z]: Vec3, margin: number): Vec3 {
    const limit = Math.max(0.1, DIAMOND_RADIUS - margin * 1.4);
    const sum = Math.abs(x) + Math.abs(y);
    let px = x;
    let py = y;
    if (sum > limit) {
      const s = limit / sum;
      px *= s;
      py *= s;
    }
    const pz = clamp(z, -(0.55 - margin), 0.55 - margin);
    return [px, py, pz];
  },
  normalAt([x, y, z]: Vec3): Vec3 {
    const nx = Math.sign(x || 1e-4) * 0.7071;
    const ny = Math.sign(y || 1e-4) * 0.7071;
    const nz = Math.sign(z || 1e-4) * 0.1;
    const len = length3(nx, ny, nz);
    return [nx / len, ny / len, nz / len];
  },
};

// 6. Hexagon (Regular Hexagonal Prism)
const HEX_R = 0.68;
export const HexagonShape: VesselShape = {
  id: "hexagon",
  name: "Hexagon",
  signedDistance([x, y, z]: Vec3): number {
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    const d2 = Math.max(ax * 0.866025 + ay * 0.5, ay) - HEX_R;
    const dz = Math.abs(z) - 0.55;
    return Math.max(d2, dz);
  },
  projectInside([x, y, z]: Vec3, margin: number): Vec3 {
    const r = Math.max(0.1, HEX_R - margin);
    const pz = clamp(z, -(0.55 - margin), 0.55 - margin);
    let px = clamp(x, -r, r);
    let py = clamp(y, -r, r);
    const d = Math.abs(px) * 0.866025 + Math.abs(py) * 0.5;
    if (d > r) {
      const factor = r / d;
      px *= factor;
      py *= factor;
    }
    return [px, py, pz];
  },
  normalAt([x, y, z]: Vec3): Vec3 {
    const eps = 0.001;
    const d = this.signedDistance([x, y, z]);
    const nx = this.signedDistance([x + eps, y, z]) - d;
    const ny = this.signedDistance([x, y + eps, z]) - d;
    const nz = this.signedDistance([x, y, z + eps]) - d;
    const len = length3(nx, ny, nz);
    return [nx / len, ny / len, nz / len];
  },
};

// 7. Capsule (Vertical Capsule)
const CAP_HALF_H = 0.32;
const CAP_RADIUS = 0.48;
export const CapsuleShape: VesselShape = {
  id: "capsule",
  name: "Capsule",
  signedDistance([x, y, z]: Vec3): number {
    const py = clamp(y, -CAP_HALF_H, CAP_HALF_H);
    return length3(x, y - py, z) - CAP_RADIUS;
  },
  projectInside([x, y, z]: Vec3, margin: number): Vec3 {
    const py = clamp(y, -CAP_HALF_H, CAP_HALF_H);
    const limit = Math.max(0.08, CAP_RADIUS - margin);
    const dx = x;
    const dy = y - py;
    const dz = z;
    const dist = length3(dx, dy, dz);
    if (dist > limit) {
      const s = limit / dist;
      return [dx * s, py + dy * s, dz * s];
    }
    return [x, y, z];
  },
  normalAt([x, y, z]: Vec3): Vec3 {
    const py = clamp(y, -CAP_HALF_H, CAP_HALF_H);
    const len = length3(x, y - py, z);
    return [x / len, (y - py) / len, z / len];
  },
};

export const SHAPES_MAP: Record<OrbShapeId, VesselShape> = {
  sphere: SphereShape,
  oval: OvalShape,
  "rounded-square": RoundedSquareShape,
  triangle: TriangleShape,
  diamond: DiamondShape,
  hexagon: HexagonShape,
  capsule: CapsuleShape,
};

export function shapeById(id: OrbShapeId): VesselShape {
  return SHAPES_MAP[id] ?? SphereShape;
}
