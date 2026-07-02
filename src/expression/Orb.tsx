// Orb —— 中央那个会呼吸的光点。expression 层的核心渲染体。
//
// 它只认识 Expression 的八个物理量与指针的物理存在(PresenceState),
// 完全不知道 Symbol、不知道学习、不知道自己在"说"什么。参数进,画面出。
// 参数变化不跳变:一切目标值都被指数阻尼缓慢追随——它是生物,不是仪表盘。

import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef, type RefObject } from 'react'
import * as THREE from 'three'
import type { Expression } from '../types'

/** 指针的物理存在:归一化位置与是否按下。不是语义,是"房间里有没有人、离多近"。 */
export interface PresenceState {
  x: number
  y: number
  down: boolean
}

// —— GLSL ——
// 3D simplex noise(Ashima Arts / Ian McEwan,MIT),有机形变与颗粒的种子。
const NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x){return x - floor(x * (1.0/289.0)) * 289.0;}
vec4 mod289(vec4 x){return x - floor(x * (1.0/289.0)) * 289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;       // 连续时间(形变、颗粒的时钟)
uniform float uPhase;      // 呼吸相位(JS 侧累积,呼吸频率变化时不跳拍)
uniform float uFlickPhase; // 闪烁相位(同上)
uniform float uAspect;
uniform float uHue;
uniform float uBrightness;
uniform float uFlickerAmp; // 0..1,闪烁的深度(由 flickerHz 折算)
uniform float uForm;
uniform float uScatter;
uniform float uConfidence;
uniform float uAwake;      // 0..1,从黑暗中醒来
uniform float uArousal;    // 0..1,指针的临场感(靠近/正在书写)
uniform vec2  uSway;       // 朝指针的细微倾身

${NOISE_GLSL}

vec3 hsl2rgb(vec3 c) {
  vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
}

void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  p.x *= uAspect;

  // 呼吸:吸得快、呼得慢的不对称曲线;偶尔一次更深的"叹息"。
  float b = sin(uPhase * 6.2831853);
  float breath = 0.82 + 0.20 * pow(0.5 + 0.5 * b, 1.7);
  float sigh = snoise(vec3(0.0, 3.7, uTime * 0.045));
  breath += 0.07 * smoothstep(0.55, 0.95, sigh);
  breath *= 1.0 + 0.10 * uArousal;

  // 不确定时的细微颤抖;倾身由 JS 缓动后传入。
  vec2 tremor = (1.0 - uConfidence) * 0.012 * vec2(
    snoise(vec3(0.0, 11.0, uTime * 1.9)),
    snoise(vec3(7.0, 0.0, uTime * 1.6)));
  vec2 q = p - uSway - tremor;

  float r = length(q);
  vec2 dir = r > 1e-5 ? q / r : vec2(1.0, 0.0);

  // 有机轮廓:noise 沿单位圆采样保证无缝;form 决定形变的频率与幅度。
  float wobFreq = mix(1.6, 6.5, uForm);
  float wobAmp  = mix(0.05, 0.30, uForm);
  float wob = snoise(vec3(dir * wobFreq, uTime * 0.16));
  float wob2 = snoise(vec3(dir * wobFreq * 2.7 + 13.0, uTime * 0.23));
  float radius = 0.30 * breath * (1.0 + wobAmp * (wob + 0.35 * wob2));

  float d = r - radius;

  // 核心 + 光晕;scatter 把光从实体推向弥漫。
  float core = smoothstep(0.015, -0.10, d) * (1.0 - 0.55 * uScatter);
  float halo = exp(-max(d, 0.0) * mix(8.0, 3.0, uScatter)) * 0.6;

  // 颗粒:scatter 高时,光化作悬浮的尘。
  float grain = snoise(vec3(q * 24.0, uTime * 0.30));
  float speck = smoothstep(0.25, 0.8, grain) * exp(-max(d, -0.08) * 2.4) * uScatter;

  // 由内而外的辉光:光从中心生出来,不是一圈雾。
  float inner = exp(-r * mix(4.5, 2.6, uScatter)) * 0.85;

  float light = core + halo + inner + speck * 0.9;

  // 内部星云:核心不是均匀的,里面有缓慢流动的明暗。
  float nebula = 0.86 + 0.14 * snoise(vec3(q * 3.0, uTime * 0.06));
  light *= nebula;

  // 闪烁:平滑噪声驱动,幅度随 flickerHz 折算,不是频闪灯。
  float flick = 1.0 - uFlickerAmp * (0.5 + 0.5 * snoise(vec3(0.0, 0.0, uFlickPhase)));
  light *= flick;

  // 低确信 → 更黯淡、更收敛;临场 → 微亮。
  light *= mix(0.55, 1.0, uConfidence);
  light *= 1.0 + 0.12 * uArousal;

  vec3 col = hsl2rgb(vec3(fract(uHue), mix(0.30, 0.55, uConfidence), 0.58));
  vec3 outCol = col * light * uBrightness * uAwake * 1.6;

  gl_FragColor = vec4(outCol, 1.0);
}
`

/** 指数阻尼:帧率无关的缓动。 */
const damp = (cur: number, target: number, lambda: number, dt: number): number =>
  THREE.MathUtils.damp(cur, target, lambda, dt)

/** 色相走色环最短弧。 */
const dampHue = (cur: number, target: number, lambda: number, dt: number): number => {
  let t = target
  if (t - cur > 0.5) t -= 1
  if (cur - t > 0.5) t += 1
  return ((damp(cur, t, lambda, dt) % 1) + 1) % 1
}

export function Orb({
  expression,
  presence,
}: {
  expression: Expression
  presence?: RefObject<PresenceState>
}) {
  const { viewport } = useThree()
  const target = useRef(expression)
  target.current = expression

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        depthWrite: false,
        depthTest: false,
        uniforms: {
          uTime: { value: 0 },
          uPhase: { value: 0 },
          uFlickPhase: { value: 0 },
          uAspect: { value: 1 },
          uHue: { value: expression.hue },
          uBrightness: { value: 0 },
          uFlickerAmp: { value: 0 },
          uForm: { value: expression.form },
          uScatter: { value: expression.scatter },
          uConfidence: { value: expression.confidence },
          uAwake: { value: 0 },
          uArousal: { value: 0 },
          uSway: { value: new THREE.Vector2(0, 0) },
        },
      }),
    // 材质只建一次;expression 之后的变化全部走 useFrame 缓动,不重建。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // 当前值(被缓动的活状态)。呼吸/闪烁用相位累积,频率变化时不跳拍。
  const live = useRef({
    hue: expression.hue,
    brightness: expression.brightness,
    breathHz: expression.breathHz,
    flickerAmp: 0,
    form: expression.form,
    scatter: expression.scatter,
    confidence: expression.confidence,
    phase: 0,
    flickPhase: 0,
    awake: 0,
    swayX: 0,
    swayY: 0,
    arousal: 0,
  })

  useFrame(({ clock }, dt) => {
    const s = live.current
    const e = target.current
    const step = Math.min(dt, 0.1) // 标签页切回时不猛跳

    s.hue = dampHue(s.hue, e.hue, 1.2, step)
    s.brightness = damp(s.brightness, e.brightness, 1.5, step)
    s.breathHz = damp(s.breathHz, e.breathHz, 1.0, step)
    s.flickerAmp = damp(s.flickerAmp, Math.min(1, e.flickerHz / 4) * 0.45, 2.0, step)
    s.form = damp(s.form, e.form, 0.9, step)
    s.scatter = damp(s.scatter, e.scatter, 1.1, step)
    s.confidence = damp(s.confidence, e.confidence, 1.0, step)
    s.phase += step * s.breathHz
    s.flickPhase += step * (0.8 + e.flickerHz * 2.0)
    s.awake = damp(s.awake, 1, 0.22, step) // 从黑暗中缓慢醒来

    // 指针的临场:朝它细微倾身;越近越"在意",按下时全神贯注。
    const pr = presence?.current
    let swayTX = 0
    let swayTY = 0
    let arousalT = 0
    if (pr) {
      const px = (pr.x - 0.5) * 2 * viewport.aspect
      const py = -(pr.y - 0.5) * 2
      const dist = Math.hypot(px, py)
      const near = 1 - Math.min(1, dist / 1.2)
      arousalT = pr.down ? 1 : near * 0.5
      const lean = 0.045 * (0.3 + 0.7 * near)
      if (dist > 1e-4) {
        swayTX = (px / dist) * lean * Math.min(1, dist * 2)
        swayTY = (py / dist) * lean * Math.min(1, dist * 2)
      }
    }
    s.swayX = damp(s.swayX, swayTX, 0.8, step)
    s.swayY = damp(s.swayY, swayTY, 0.8, step)
    s.arousal = damp(s.arousal, arousalT, 1.4, step)

    const u = material.uniforms
    u.uTime.value = clock.elapsedTime
    u.uPhase.value = s.phase
    u.uFlickPhase.value = s.flickPhase
    u.uAspect.value = viewport.aspect
    u.uHue.value = s.hue
    u.uBrightness.value = s.brightness
    u.uFlickerAmp.value = s.flickerAmp
    u.uForm.value = s.form
    u.uScatter.value = s.scatter
    u.uConfidence.value = s.confidence
    u.uAwake.value = s.awake
    u.uArousal.value = s.arousal
    ;(u.uSway.value as THREE.Vector2).set(s.swayX, s.swayY)
  })

  return (
    <mesh scale={[viewport.width, viewport.height, 1]} material={material}>
      <planeGeometry args={[1, 1]} />
    </mesh>
  )
}
