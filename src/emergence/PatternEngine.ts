// PatternEngine —— 无先验的在线模式学习引擎(Growing Neural Gas 的阈值生长变体,
// 亦即 Grow-When-Required 思路:不预设簇数量,新模式到来时自己长出新节点)。
//
// 它只吃 FeatureVector,只输出 Symbol 与事件。它不知道向量从哪来,更不知道向量"画的是什么"。
// 理解从零长出来:第一次见到的模式是胚胎,重复让它强化,冷落让它衰减直至死亡。
//
// 参数气质(对应"快而活泼,但快的是响应不是遗忘"):
//  - 诞生阈值偏低:明显的新模式立刻长出新节点,涌现密集,黑暗里很快有回应;
//  - 质心吸附强:轻微变化被归入旧词并把质心拉向新样本(你变化,它漂移);
//  - 衰减用半衰期:遗忘是缓慢的、连续的,不是开关。

import { FEATURE_DIM, type EmergenceEvent, type FeatureVector, type Symbol } from '../types'

export interface EngineConfig {
  /** 新样本到最近节点的距离超过它才诞生新节点。偏低 → 涌现密集。(16 维 [0,1] 特征下,相似手势通常 < 0.3,相异 > 1) */
  noveltyDistance: number
  /** 强化时质心向样本移动的比例。偏高 → 吸附强,旧词跟着使用者漂移。 */
  attachRate: number
  /** 强化时 strength 的补偿增益:strength += (1 - strength) * gain。 */
  reinforceGain: number
  /** 新生节点的初始强度。胚胎不该生而即死,也不该生而笃定。 */
  initialStrength: number
  /** 强度衰减半衰期,毫秒。时间以样本时间戳推进,引擎不读墙上时钟,保持纯逻辑可测。 */
  decayHalfLifeMs: number
  /** 强度低于它即死亡。 */
  deathThreshold: number
}

export const DEFAULT_CONFIG: EngineConfig = {
  noveltyDistance: 0.45,
  attachRate: 0.25,
  reinforceGain: 0.3,
  initialStrength: 0.3,
  decayHalfLifeMs: 90_000,
  deathThreshold: 0.05,
}

const distance = (a: number[], b: number[]): number => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) * (a[i] - b[i])
  return Math.sqrt(s)
}

export class PatternEngine {
  private readonly cfg: EngineConfig
  private readonly nodes = new Map<string, Symbol>()
  /** 上一次观察的时刻。衰减按观察间隔均匀作用于所有节点,被强化者随即被抬回。 */
  private lastT: number | null = null
  private seq = 0

  constructor(config: Partial<EngineConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 喂入一个特征向量,返回本次观察引发的事件(先报死亡,再报诞生/强化)。
   * 这是引擎唯一的输入口;除此之外没有任何方法能改变引擎状态。
   */
  observe(f: FeatureVector): EmergenceEvent[] {
    if (f.vec.length !== FEATURE_DIM) {
      throw new Error(`expected FEATURE_DIM=${FEATURE_DIM}, got ${f.vec.length}`)
    }
    const events: EmergenceEvent[] = []

    // 1) 时间流逝:所有节点按半衰期衰减,归零者死亡。
    this.decayTo(f.t, events)

    // 2) 寻找最近的活体节点。
    let nearest: Symbol | null = null
    let nearestDist = Infinity
    for (const node of this.nodes.values()) {
      const d = distance(node.centroid, f.vec)
      if (d < nearestDist) {
        nearest = node
        nearestDist = d
      }
    }

    if (nearest !== null && nearestDist <= this.cfg.noveltyDistance) {
      // 3a) 够近 → 这个模式又出现了:强化,质心向样本吸附。
      // 吸附率恒定而非随 count 递减:漂移是特性——词的用法变了,词就跟着变。
      nearest.count += 1
      nearest.strength = Math.min(1, nearest.strength + (1 - nearest.strength) * this.cfg.reinforceGain)
      for (let i = 0; i < nearest.centroid.length; i++) {
        nearest.centroid[i] += (f.vec[i] - nearest.centroid[i]) * this.cfg.attachRate
      }
      events.push({ type: 'reinforced', symbolId: nearest.id })
    } else {
      // 3b) 够远(或一片空白)→ 一个新"词"的胚胎诞生。
      const id = `s-${(this.seq++).toString(36)}`
      this.nodes.set(id, {
        id,
        centroid: [...f.vec],
        born: f.t,
        count: 1,
        strength: this.cfg.initialStrength,
      })
      events.push({ type: 'born', symbolId: id })
    }
    return events
  }

  /**
   * 时间流逝但无话可说:只推进衰减与死亡,不做匹配。
   * 给编排层在沉默期定时调用——遗忘不需要新的话语来触发。
   */
  tick(t: number): EmergenceEvent[] {
    const events: EmergenceEvent[] = []
    this.decayTo(t, events)
    return events
  }

  /** 活体 Symbol 的深拷贝快照。返回副本而非引用:下游只许读,不许反向偷改引擎状态。 */
  snapshot(): Symbol[] {
    return [...this.nodes.values()].map((n) => ({ ...n, centroid: [...n.centroid] }))
  }

  /** 单个 Symbol 的深拷贝,不存在(或已死亡)返回 undefined。 */
  get(id: string): Symbol | undefined {
    const n = this.nodes.get(id)
    return n === undefined ? undefined : { ...n, centroid: [...n.centroid] }
  }

  private decayTo(t: number, events: EmergenceEvent[]): void {
    if (this.lastT !== null) {
      const dt = Math.max(0, t - this.lastT)
      if (dt > 0) {
        const factor = Math.pow(0.5, dt / this.cfg.decayHalfLifeMs)
        for (const [id, node] of this.nodes) {
          node.strength *= factor
          if (node.strength < this.cfg.deathThreshold) {
            this.nodes.delete(id)
            events.push({ type: 'died', symbolId: id })
          }
        }
      }
    }
    this.lastT = t
  }
}
