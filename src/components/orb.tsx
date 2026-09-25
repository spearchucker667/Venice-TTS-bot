import { useEffect, useRef } from "react";
import { readLevel } from "@/audio";
import { COUNT, createSim, displayRadius, stepSim } from "@/physics";
import { flowById, lampById, visual, type Mood } from "@/state";

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

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / min(uRes.x, uRes.y);
  vec3 ro = vec3(0.0, 0.08, 2.45);
  vec3 rd = normalize(vec3(p * 1.05, -1.28));
  float rad = 1.0 + uLevel * 0.04 + (uMood > 2.5 && uMood < 3.5 ? 0.015 : 0.0);
  float b = dot(ro, rd);
  float c = dot(ro, ro) - rad * rad;
  float h = b * b - c;
  if (h < 0.0) {
    outColor = vec4(0.0);
    return;
  }
  float s = sqrt(h);
  float t0 = max(-b - s, 0.0);
  float t1 = -b + s;
  vec3 n = normalize(ro + rd * t0);
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

export function Orb() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const shell = document.createElement("div");
    shell.style.cssText = "width:100%;height:100%";
    host.replaceChildren(shell);
    const root = shell.attachShadow({ mode: "closed" });
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "width:100%;height:100%;display:block";
    root.appendChild(canvas);

    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      powerPreference: "high-performance",
    });
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
    const onLost = (event: Event) => {
      event.preventDefault();
      cancelAnimationFrame(raf);
      host.dataset.gl = "lost";
    };
    canvas.addEventListener("webglcontextlost", onLost);
    const stop = () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener("webglcontextlost", onLost);
      if (gl && prog) gl.deleteProgram(prog);
      if (gl && vs) gl.deleteShader(vs);
      if (gl && fs) gl.deleteShader(fs);
      if (host.contains(shell)) host.replaceChildren();
    };
    if (!gl) return stop;

    vs = compile(gl, gl.VERTEX_SHADER, VERT);
    fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) {
      host.dataset.gl = compileError || "compile";
      return stop;
    }
    prog = gl.createProgram();
    if (!prog) return stop;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      host.dataset.gl = gl.getProgramInfoLog(prog) || "link";
      return stop;
    }
    gl.useProgram(prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const loc = (name: string) => gl.getUniformLocation(prog as WebGLProgram, name);
    const uRes = loc("uRes");
    const uTime = loc("uTime");
    const uLevel = loc("uLevel");
    const uMood = loc("uMood");
    const uMotion = loc("uMotion");
    const uTwist = loc("uTwist");
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
      if (document.hidden) return;
      const reduced = motionQuery.matches;
      if (reduced && now - lastDraw < 280) return;
      lastDraw = now;
      visual.reduced = reduced;
      visual.level = readLevel();
      const flow = flowById(visual.flow);
      stepSim(sim, reduced ? 0 : dt, visual.mood, reduced, flow.motion, flow.buoy, flow.pull);
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
      gl.uniform3fv(uCool, lamp.cool);
      gl.uniform3fv(uMid, lamp.mid);
      gl.uniform3fv(uHot, lamp.hot);
      gl.uniform3fv(uRim, lamp.rim);
      gl.uniform4fv(uBlob, blobs);
      gl.uniform1fv(uHeat, heat);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    raf = requestAnimationFrame(frame);
    return stop;
  }, []);

  return <div ref={hostRef} className="orb" aria-hidden="true" />;
}
