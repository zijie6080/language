// ExpressionBinder —— 意义协商层:Symbol ↔ Expression 的双向绑定。
//
// 一个新 Symbol 诞生时,它"如何被说出来"是从表达空间里随机抽取的——
// 不查表、不按形状配色、没有任何"圆该是什么颜色"的预设。
// 这个随机初值只是协商的起点:
//   用户重复回应 → reinforce:confidence 上升,这种说法被双方默认;
//   用户给出新变化 → drift:参数轻微漂移,协商重新打开,说法跟着互动走。
// 意义不在这里被定义,而是在这里被慢慢"谈"出来。
//
// 纯逻辑:不渲染,不认识几何,不读墙上时钟。

import type { Expression } from '../types'

/** mulberry32:种子化伪随机。注入种子可让测试完全复现;不给种子则每次相遇都是新的开始。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
/** 色相在色环上回绕,漂移没有尽头也没有边界。 */
const wrap01 = (v: number): number => ((v % 1) + 1) % 1

// —— 表达空间的物理边界(不是意义,是媒介的可感范围)——
const BREATH_RANGE = [0.05, 1.2] as const   // 呼吸快慢的极限:慢到近乎静止,快不过心跳
const FLICKER_MAX = 4                        // 闪烁上限,再快就成了噪声
const TONE_RANGE = [80, 1500] as const       // 可听且不刺耳的频段
const REINFORCE_GAIN = 0.18                  // 重复回应时 confidence 的补偿增益
const CONFIDENCE_DRIFT_DAMP = 0.95           // 漂移让笃定略微松动:协商重新打开

export class ExpressionBinder {
  private readonly bindings = new Map<string, Expression>()
  private readonly rnd: () => number

  constructor(seed?: number) {
    this.rnd = mulberry32(seed ?? (Math.random() * 0xffffffff) >>> 0)
  }

  /**
   * 为一个新诞生的 Symbol 抽取初始表达。已绑定的 id 直接返回既有绑定(诞生只有一次)。
   * 初值气质:新生的词是试探性的——不太亮、呼吸缓、confidence 低;形态与色相完全随机。
   */
  bind(symbolId: string): Expression {
    const existing = this.bindings.get(symbolId)
    if (existing !== undefined) return { ...existing }
    const r = this.rnd
    const expr: Expression = {
      hue: r(),
      brightness: 0.25 + r() * 0.35,
      breathHz: 0.08 + r() * 0.32,
      flickerHz: r() * r() * 3, // 平方偏置:多数新生几乎不闪,偶有一个天生急促
      form: r(),
      scatter: r() * 0.5, // 新生先凝聚,弥漫是后来学会的
      toneHz: 130.8 * Math.pow(2, r() * 2.5), // 对数均匀:音高的感知是指数的
      confidence: 0.1 + r() * 0.15,
    }
    this.bindings.set(symbolId, expr)
    return { ...expr }
  }

  /** 读取绑定的深拷贝;未绑定(或已解除)返回 undefined。下游只许读,不许写回。 */
  getExpression(symbolId: string): Expression | undefined {
    const e = this.bindings.get(symbolId)
    return e === undefined ? undefined : { ...e }
  }

  /** 用户重复回应了这个 Symbol:这种说法被默认,confidence 补偿式上升,其余参数纹丝不动。 */
  reinforce(symbolId: string): Expression | undefined {
    const e = this.bindings.get(symbolId)
    if (e === undefined) return undefined
    e.confidence = clamp(e.confidence + (1 - e.confidence) * REINFORCE_GAIN, 0, 1)
    return { ...e }
  }

  /**
   * 用户在这个 Symbol 上给出了新变化:表达参数做一次轻微的随机游走,
   * confidence 微降——旧的默契松动了一点,新的说法正在被试探。
   */
  drift(symbolId: string): Expression | undefined {
    const e = this.bindings.get(symbolId)
    if (e === undefined) return undefined
    const r = this.rnd
    const step = (amp: number) => (r() - 0.5) * 2 * amp
    e.hue = wrap01(e.hue + step(0.04))
    e.brightness = clamp(e.brightness + step(0.05), 0.05, 1)
    e.breathHz = clamp(e.breathHz * Math.pow(2, step(0.15)), BREATH_RANGE[0], BREATH_RANGE[1])
    e.flickerHz = clamp(e.flickerHz + step(0.3), 0, FLICKER_MAX)
    e.form = clamp(e.form + step(0.06), 0, 1)
    e.scatter = clamp(e.scatter + step(0.08), 0, 1)
    e.toneHz = clamp(e.toneHz * Math.pow(2, step(0.08)), TONE_RANGE[0], TONE_RANGE[1])
    e.confidence = clamp(e.confidence * CONFIDENCE_DRIFT_DAMP, 0.05, 1)
    return { ...e }
  }

  /** Symbol 死亡时解除绑定。历史归 memory 层的树,活体绑定只服务活着的词。 */
  unbind(symbolId: string): void {
    this.bindings.delete(symbolId)
  }
}
