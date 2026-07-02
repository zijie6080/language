// Session —— 组合根的编排器:唯一同时认识所有层的地方。
// 指针事件 → perception 编码 → emergence 学习 → mapping 取表达 → memory 落库,
// 并把"此刻该说的话"(一个 Expression)交还给渲染侧。
//
// 数据只沿一个方向流。Session 不含任何 React、不含渲染、不读墙上时钟(时间由调用方传入),
// 因此整个闭环可以在测试里离屏跑通。

import { GestureEncoder } from './perception'
import { PatternEngine } from './emergence'
import { ExpressionBinder } from './mapping'
import { LanguageMemory } from './memory'
import { languageStore, type LanguageStore } from './store'
import type { Expression, RawSample, Symbol } from './types'

/** 一次回应:光点该说的话,以及这句话停留多久(之后渐渐退回基线)。 */
export interface Utterance {
  expression: Expression
  holdMs: number
}

/** 与匹配 Symbol 的旧质心距离小于它 → 视为"重复回应"(强化);否则视为"给出新变化"(漂移)。 */
const ECHO_DISTANCE = 0.18

const dist = (a: number[], b: number[]): number => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) * (a[i] - b[i])
  return Math.sqrt(s)
}

export class Session {
  private readonly encoder = new GestureEncoder()
  private readonly engine = new PatternEngine()
  private readonly binder: ExpressionBinder
  private readonly memory: LanguageMemory
  private stroke: RawSample[] = []

  constructor(store: LanguageStore = languageStore, seed?: number) {
    this.binder = new ExpressionBinder(seed)
    this.memory = new LanguageMemory(store)
  }

  /** 一次手势的开始(落笔)。 */
  begin(sample: RawSample): void {
    this.stroke = [sample]
  }

  /** 手势进行中(移动)。落笔之前的移动被忽略——注视不是话语。 */
  move(sample: RawSample): void {
    if (this.stroke.length > 0) this.stroke.push(sample)
  }

  /**
   * 手势结束(抬笔):整个闭环在这里转一圈。
   * 返回光点该说的话;这个人还什么都没说过(空手势)则返回 null。
   */
  end(sample: RawSample): Utterance | null {
    if (this.stroke.length === 0) return null
    this.stroke.push(sample)
    const gesture = this.stroke
    this.stroke = []

    // 感知:手势 → 特征向量。
    const feature = this.encoder.encode(gesture)

    // 学习之前,记住"它原来最像谁、有多像"——这决定回应是强化还是漂移,
    // 也决定新词在树上的出处(离它最近的旧词)。
    const before = this.engine.snapshot()
    let nearest: Symbol | null = null
    let nearestDist = Infinity
    for (const s of before) {
      const d = dist(s.centroid, feature.vec)
      if (d < nearestDist) {
        nearest = s
        nearestDist = d
      }
    }

    // 学习:向量进,事件出。
    const events = this.engine.observe(feature)

    let utterance: Utterance | null = null
    for (const ev of events) {
      switch (ev.type) {
        case 'died': {
          this.binder.unbind(ev.symbolId)
          this.memory.recordDeath(ev.symbolId, feature.t)
          break
        }
        case 'born': {
          const symbol = this.engine.get(ev.symbolId)!
          const expression = this.binder.bind(ev.symbolId)
          // 新词从离它最近的旧词上分化而来;一片空白时它就是根。
          this.memory.recordBirth(symbol, expression, nearest?.id)
          utterance = { expression, holdMs: holdFor(expression) }
          break
        }
        case 'reinforced': {
          const symbol = this.engine.get(ev.symbolId)!
          const expression =
            nearestDist < ECHO_DISTANCE
              ? this.binder.reinforce(ev.symbolId)!
              : this.binder.drift(ev.symbolId)!
          this.memory.recordReinforce(symbol, expression)
          utterance = { expression, holdMs: holdFor(expression) }
          break
        }
      }
    }
    return utterance
  }

  /** 沉默期的心跳:推进遗忘,同步活体的连续衰减。定时调用。 */
  tick(t: number): void {
    for (const ev of this.engine.tick(t)) {
      if (ev.type === 'died') {
        this.binder.unbind(ev.symbolId)
        this.memory.recordDeath(ev.symbolId, t)
      }
    }
    this.memory.syncSymbols(this.engine.snapshot())
  }
}

/** 一句话停留多久:越笃定,说得越久、越从容。 */
function holdFor(e: Expression): number {
  return 2600 + e.confidence * 3400
}
