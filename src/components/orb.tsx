import { useEffect, useRef } from "react";
import { readLevel } from "@/audio";
import { COUNT, createSim, displayRadius, stepSim } from "@/physics";
import { shapeById } from "@/shapes";
import { flowById, lampById, visual, type Mood } from "@/state";
import type { OrbShapeId } from "@/theme";

const VERT = `#version 300 es
void main() {
  vec2 verts[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  gl_Position = vec4(verts[gl_VertexID], 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uLevel;
uniform float uMood;
uniform float uMotion;
uniform float uTwist;
uniform int uShape;
uniform vec3 uCool;
uniform vec3 uMid;
uniform vec3 uHot;
uniform vec3 uRim;
uniform vec4 uBlob[8];
uniform float uHeat[8];
out vec4 outColor;

vec2 rot(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}

void addBlob(vec3 p, vec4 b, float heat, inout float field, inout vec3 col) {
  vec3 d = p - b.xyz;
  float h = clamp(heat, 0.0, 1.0);
  d.y /= mix(1.12, 0.78, h);
  float r = max(b.w, 0.08);
  float w = exp(-dot(d, d) / (r * r) * 2.05);
  field += w;
  vec3 wax = mix(uCool, uMid, smoothstep(0.0, 0.42, h));
  wax = mix(wax, uHot, smoothstep(0.28, 0.92, h));
  col += wax * w;
}

void blobField(vec3 p, out float field, out vec3 col) {
  float spin = uTwist * max(uMotion, 0.2);
  p.xz = rot(p.xz, p.y * spin * 0.55 + uTime * 0.045 * spin);
  vec3 q = p;
  q.y -= uTime * 0.18 * uMotion;
  float amp = (0.045 + 0.055 * clamp(uTwist, 0.15, 2.2)) * uMotion;
  float n1 = noise(q * 1.8);
  float n2 = noise(q * 3.4 + vec3(4.1, 1.7, 2.2));
  p += (vec3(n1, n2, n1 * 0.65 + n2 * 0.35) - 0.45) * amp;
  field = 0.0;
  col = vec3(0.0);
  addBlob(p, uBlob[0], uHeat[0], field, col);
  addBlob(p, uBlob[1], uHeat[1], field, col);
  addBlob(p, uBlob[2], uHeat[2], field, col);
  addBlob(p, uBlob[3], uHeat[3], field, col);
  addBlob(p, uBlob[4], uHeat[4], field, col);
  addBlob(p, uBlob[5], uHeat[5], field, col);
  addBlob(p, uBlob[6], uHeat[6], field, col);
  addBlob(p, uBlob[7], uHeat[7], field, col);
  if (field > 0.0001) col /= field;
}

float sdSphere(vec3 p, float r) {
  return length(p) - r;
}

float sdOval(vec3 p, float r) {
  vec3 axes = vec3(0.82, 0.62, 0.72) * (r / 0.74);
  return (length(p / axes) - 1.0) * min(axes.x, min(axes.y, axes.z));
}

float sdRoundedSquare(vec3 p, float r) {
  vec3 b = vec3(0.48, 0.48, 0.48) * (r / 0.74);
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - (0.22 * (r / 0.74));
}

float sdTriangle(vec3 p, float r) {
  float k = sqrt(3.0);
  float s = r / 0.74;
  vec2 p2 = p.xy / s;
  p2.x = abs(p2.x) - 0.65;
  p2.y = p2.y + 0.65 / k;
  if (p2.x + k * p2.y > 0.0) p2 = vec2(p2.x - k * p2.y, -k * p2.x - p2.y) * 0.5;
  p2.x -= clamp(p2.x, -1.3, 0.0);
  float d2 = -length(p2) * sign(p2.y) - 0.1;
  float dz = abs(p.z) - 0.55 * s;
  return max(d2 * s, dz);
}

float sdDiamond(vec3 p, float r) {
  float s = r / 0.74;
  float d2 = (abs(p.x) + abs(p.y) - 0.68 * s) * 0.7071;
  float dz = abs(p.z) - 0.55 * s;
  return max(d2, dz);
}

float sdHexagon(vec3 p, float r) {
  float s = r / 0.74;
  vec2 q = abs(p.xy);
  float d2 = max(q.x * 0.866025 + q.y * 0.5, q.y) - 0.68 * s;
  float dz = abs(p.z) - 0.55 * s;
  return max(d2, dz);
}

float sdCapsule(vec3 p, float r) {
  float s = r / 0.74;
  float py = clamp(p.y, -0.32 * s, 0.32 * s);
  return length(p - vec3(0.0, py, 0.0)) - 0.48 * s;
}

float vesselSDF(vec3 p, float r, int shape) {
  if (shape == 1) return sdOval(p, r);
  if (shape == 2) return sdRoundedSquare(p, r);
  if (shape == 3) return sdTriangle(p, r);
  if (shape == 4) return sdDiamond(p, r);
  if (shape == 5) return sdHexagon(p, r);
  if (shape == 6) return sdCapsule(p, r);
  return sdSphere(p, r);
}

vec3 vesselNormal(vec3 p, float r, int shape) {
  float eps = 0.002;
  float d = vesselSDF(p, r, shape);
  return normalize(vec3(
    vesselSDF(p + vec3(eps, 0.0, 0.0), r, shape) - d,
    vesselSDF(p + vec3(0.0, eps, 0.0), r, shape) - d,
    vesselSDF(p + vec3(0.0, 0.0, eps), r, shape) - d
  ));
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / min(uRes.x, uRes.y);
  vec3 ro = vec3(0.0, 0.08, 2.45);
  vec3 rd = normalize(vec3(p * 1.05, -1.28));
  float rad = 1.0 + uLevel * 0.04 + (uMood > 2.5 && uMood < 3.5 ? 0.015 : 0.0);

  float t0 = -1.0;
  float t1 = -1.0;
  vec3 n = vec3(0.0, 0.0, 1.0);

  if (uShape == 0) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - rad * rad;
    float h = b * b - c;
    if (h < 0.0) {
      outColor = vec4(0.0);
      return;
    }
    float s = sqrt(h);
    t0 = max(-b - s, 0.0);
    t1 = -b + s;
    n = normalize(ro + rd * t0);
  } else {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - rad * rad * 1.5;
    float h = b * b - c;
    if (h < 0.0) {
      outColor = vec4(0.0);
      return;
    }
    float s = sqrt(h);
    float tNear = max(-b - s, 0.0);
    float tFar = -b + s;
    float t = tNear;
    float vR = rad * 0.74;

    for (int st = 0; st < 24; st++) {
      vec3 cp = ro + rd * t;
      float d = vesselSDF(cp, vR, uShape);
      if (d < 0.003) {
        t0 = t;
        break;
      }
      t += max(d * 0.85, 0.01);
      if (t > tFar) break;
    }
    if (t0 < 0.0) {
      outColor = vec4(0.0);
      return;
    }
    float tExit = t0 + 0.08;
    for (int st = 0; st < 18; st++) {
      vec3 cp = ro + rd * tExit;
      float d = vesselSDF(cp, vR, uShape);
      if (d > 0.003) {
        t1 = tExit;
        break;
      }
      tExit += max(abs(d) * 0.85, 0.04);
      if (tExit > tFar) {
        t1 = tFar;
        break;
      }
    }
    if (t1 <= t0) t1 = t0 + 0.4;
    n = vesselNormal(ro + rd * t0, vR, uShape);
  }

  float ndv = max(dot(n, -rd), 0.0);
  float fres = pow(1.0 - ndv, 2.4);
  vec3 refl = reflect(rd, n);
  float window = smoothstep(0.15, 0.8, refl.y) * smoothstep(0.55, -0.15, abs(refl.x + 0.15));
  vec3 env = uCool * 0.16 + uHot * window * 0.72;

  const int STEPS = 28;
  float travel = t1 - t0;
  float dt = travel / float(STEPS);
  vec3 acc = vec3(0.0);
  float trans = 1.0;
  float boost = 0.0;
  if (uMood > 2.5 && uMood < 3.5) boost = 0.55 + uLevel * 2.2;
  else if (uMood > 1.5 && uMood < 2.5) boost = 0.32;
  else if (uMood > 3.5 && uMood < 4.5) boost = 0.2;
  else if (uMood > 4.5) boost = -0.35;

  for (int i = 0; i < STEPS; i++) {
    vec3 pos = ro + rd * (t0 + (float(i) + 0.5) * dt);
    float field;
    vec3 wax;
    blobField(pos, field, wax);
    float density = smoothstep(0.34, 0.62, field);
    float core = smoothstep(0.72, 1.25, field);
    vec3 body = mix(wax, mix(wax, uHot, 0.55), core);
    float emit = (density * 1.25 + core * 1.7) * (1.05 + boost * 0.4);
    acc += trans * body * emit * dt * 3.6;
    float yN = pos.y;
    vec3 oil = mix(uCool * 0.55, uMid * 0.35, smoothstep(-0.2, 0.6, yN));
    oil += uHot * smoothstep(0.05, -0.75, yN) * 0.55;
    acc += trans * oil * (1.0 - density) * dt * 0.85;
    trans *= exp(-(density * 2.8 + 0.08) * dt);
    if (trans < 0.02) break;
  }

  vec3 col = acc;
  vec3 glass = mix(uCool, uMid, 0.4) * 0.42 + uRim * fres * 0.55;
  col = mix(glass, col, clamp(length(col) * 1.4, 0.35, 1.0));
  col = mix(col, env, fres * 0.28);
  vec3 lightDir = normalize(vec3(-0.42, 0.82, 0.45));
  float spec = pow(max(dot(reflect(-lightDir, n), -rd), 0.0), 42.0);
  col += spec * vec3(1.0, 0.97, 0.9) * 0.85;
  col += fres * uRim * 0.22;
  if (uMood > 0.5 && uMood < 1.5) col += uHot * 0.08;
  col = 1.0 - exp(-col * 1.15);
  float alpha = clamp(0.72 + fres * 0.22 + (1.0 - trans) * 0.2, 0.0, 1.0);
  outColor = vec4(col * alpha, alpha);
}`;

let compileError = "";

const MOOD_ID: Record<Mood, number> = {
  idle: 0,
  listen: 1,
  think: 2,
  speak: 3,
  tool: 4,
  error: 5,
};

const SHAPE_ID: Record<OrbShapeId, number> = {
  sphere: 0,
  oval: 1,
  "rounded-square": 2,
  triangle: 3,
  diamond: 4,
  hexagon: 5,
  capsule: 6,
};

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    compileError = gl.getShaderInfoLog(shader) || "shader failed";
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function Orb({ shape }: { shape?: OrbShapeId } = {}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const currentShape = shape ?? visual.shape ?? "sphere";
    host.dataset.orbShape = currentShape;

    const shell = document.createElement("div");
    shell.style.cssText = "width:100%;height:100%";
    host.replaceChildren(shell);
    const root = shell.attachShadow({ mode: "closed" });
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "width:100%;height:100%;display:block";
    root.appendChild(canvas);

    let isVisible = true;
    const io = new IntersectionObserver((entries) => {
      const entry = entries[0];
      isVisible = Boolean(entry?.isIntersecting);
    });
    io.observe(host);

    let gl: WebGL2RenderingContext | null = null;
    let raf = 0;
    let prog: WebGLProgram | null = null;
    let vs: WebGLShader | null = null;
    let fs: WebGLShader | null = null;
    let viewW = 2;
    let viewH = 2;

    const measure = () => {
      const rect = host.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.max(2, Math.floor(rect.width * dpr));
      const h = Math.max(2, Math.floor(rect.height * dpr));
      const down = Math.min(1, 720 / Math.max(w, h));
      viewW = Math.max(2, Math.floor(w * down));
      viewH = Math.max(2, Math.floor(h * down));
    };
    measure();
    const observer = new ResizeObserver(() => measure());
    observer.observe(host);

    const initGL = () => {
      gl = canvas.getContext("webgl2", {
        alpha: true,
        antialias: false,
        premultipliedAlpha: true,
        powerPreference: visual.reduced ? "low-power" : "high-performance",
      });
      if (!gl) return false;

      vs = compile(gl, gl.VERTEX_SHADER, VERT);
      fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) {
        host.dataset.gl = compileError || "compile";
        return false;
      }
      prog = gl.createProgram();
      if (!prog) return false;
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        host.dataset.gl = gl.getProgramInfoLog(prog) || "link";
        return false;
      }
      gl.useProgram(prog);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      return true;
    };

    if (!initGL()) {
      return () => {
        observer.disconnect();
        io.disconnect();
        if (host.contains(shell)) host.replaceChildren();
      };
    }

    const onLost = (event: Event) => {
      event.preventDefault();
      cancelAnimationFrame(raf);
      host.dataset.gl = "lost";
    };

    const onRestored = () => {
      host.dataset.gl = "restoring";
      if (initGL()) {
        host.dataset.gl = "ok";
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };

    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);

    const loc = (name: string): WebGLUniformLocation | null =>
      prog && gl ? gl.getUniformLocation(prog, name) : null;
    const uRes = loc("uRes");
    const uTime = loc("uTime");
    const uLevel = loc("uLevel");
    const uMood = loc("uMood");
    const uMotion = loc("uMotion");
    const uTwist = loc("uTwist");
    const uShape = loc("uShape");
    const uCool = loc("uCool");
    const uMid = loc("uMid");
    const uHot = loc("uHot");
    const uRim = loc("uRim");
    const uBlob = loc("uBlob[0]");
    const uHeat = loc("uHeat[0]");
    const blobs = new Float32Array(COUNT * 4);
    const heat = new Float32Array(COUNT);
    const sim = createSim();
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let last = performance.now();
    let lastDraw = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (document.hidden || !isVisible || !gl || !prog) return;

      const reduced = motionQuery.matches;
      if (reduced && now - lastDraw < 280) return;
      lastDraw = now;
      visual.reduced = reduced;
      visual.level = readLevel();

      const activeShape = shape ?? visual.shape ?? "sphere";
      host.dataset.orbShape = activeShape;
      const vessel = shapeById(activeShape);
      const flow = flowById(visual.flow);

      stepSim(
        sim,
        reduced ? 0 : dt,
        visual.mood,
        reduced,
        flow.motion,
        flow.buoy,
        flow.pull,
        vessel,
      );

      const lamp = lampById(visual.lamp);
      if (canvas.width !== viewW || canvas.height !== viewH) {
        canvas.width = viewW;
        canvas.height = viewH;
      }
      gl.viewport(0, 0, viewW, viewH);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      for (let i = 0; i < COUNT; i++) {
        const o = i * 3;
        blobs[i * 4] = sim.p[o] ?? 0;
        blobs[i * 4 + 1] = sim.p[o + 1] ?? 0;
        blobs[i * 4 + 2] = sim.p[o + 2] ?? 0;
        blobs[i * 4 + 3] = displayRadius(sim.rad[i] ?? 0.2, visual.mood, visual.level);
        heat[i] = sim.heat[i] ?? 0;
      }

      gl.uniform2f(uRes, viewW, viewH);
      gl.uniform1f(uTime, reduced ? 0 : sim.time);
      gl.uniform1f(uLevel, visual.level);
      gl.uniform1f(uMood, MOOD_ID[visual.mood]);
      gl.uniform1f(uMotion, reduced ? 0 : flow.motion);
      gl.uniform1f(uTwist, flow.twist);
      gl.uniform1i(uShape, SHAPE_ID[activeShape] ?? 0);
      gl.uniform3fv(uCool, lamp.cool);
      gl.uniform3fv(uMid, lamp.mid);
      gl.uniform3fv(uHot, lamp.hot);
      gl.uniform3fv(uRim, lamp.rim);
      gl.uniform4fv(uBlob, blobs);
      gl.uniform1fv(uHeat, heat);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      io.disconnect();
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      if (gl && prog) gl.deleteProgram(prog);
      if (gl && vs) gl.deleteShader(vs);
      if (gl && fs) gl.deleteShader(fs);
      if (host.contains(shell)) host.replaceChildren();
    };
  }, [shape]);

  return <div ref={hostRef} className="orb" aria-hidden="true" />;
}
