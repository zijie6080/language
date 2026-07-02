// Voice —— 光的声音。expression 层的听觉半身:只认识 Expression 的物理量,
// 不知道 Symbol,不知道词义。参数进,声音出。
//
// 声音设计与光同构:
//  - 呼吸噪声床:极轻的粉噪经低通,以 breathHz 起伏——黑暗里那口一直在的气息;
//  - 纯音:toneHz 的正弦,经颤音(与呼吸同频)与长混响,像从很远的地方发声;
//  - confidence 低 → 低通更闷、更迟疑;flickerHz → 颤音加深加快;
//  - toneHz = 0 是沉默(契约如此),只剩呼吸。
// 一切电平变化都是缓坡,没有任何突兀的起停。

import * as Tone from 'tone'
import type { Expression } from '../types'

const TONE_PEAK = 0.16 // 纯音的最大线性电平:氛围,不是旋律
const BED_PEAK = 0.045 // 呼吸床的电平上限:几乎意识不到,但关掉就空了

export class Voice {
  private started = false
  private starting = false
  private osc!: Tone.Oscillator
  private tremolo!: Tone.Tremolo
  private filter!: Tone.Filter
  private toneGain!: Tone.Gain
  private bedGain!: Tone.Gain
  private breathLfo!: Tone.LFO
  private releaseTimer: ReturnType<typeof setTimeout> | null = null

  /** 在用户第一次触碰时唤醒(浏览器要求音频由手势开启)。幂等。 */
  async wake(baseline: Expression): Promise<void> {
    if (this.started || this.starting) return
    this.starting = true
    try {
      await Tone.start()
      const reverb = new Tone.Reverb({ decay: 9, preDelay: 0.04, wet: 0.55 }).toDestination()

      // 纯音链:osc → 颤音 → 低通 → 增益 → 混响
      this.toneGain = new Tone.Gain(0).connect(reverb)
      this.filter = new Tone.Filter(900, 'lowpass').connect(this.toneGain)
      this.tremolo = new Tone.Tremolo(baseline.breathHz, 0.3).connect(this.filter).start()
      this.osc = new Tone.Oscillator({ frequency: 220, type: 'sine' }).connect(this.tremolo).start()

      // 呼吸床:粉噪 → 低通 → 呼吸起伏的增益
      this.bedGain = new Tone.Gain(0).connect(reverb)
      const bedFilter = new Tone.Filter(210, 'lowpass').connect(this.bedGain)
      new Tone.Noise('pink').connect(bedFilter).start()
      this.breathLfo = new Tone.LFO({
        frequency: baseline.breathHz,
        min: BED_PEAK * 0.25,
        max: BED_PEAK,
      }).start()
      this.breathLfo.connect(this.bedGain.gain)

      await reverb.ready
      this.started = true
    } finally {
      this.starting = false
    }
  }

  /** 说一句话:向这组表达参数缓坡过去,停留 holdMs 后自行退回沉默。 */
  speak(e: Expression, holdMs: number): void {
    if (!this.started) return
    if (this.releaseTimer !== null) clearTimeout(this.releaseTimer)

    // 呼吸的频率同步到这句话(光与声共用同一次呼吸)。
    this.breathLfo.frequency.rampTo(e.breathHz, 1.2)
    this.tremolo.frequency.rampTo(Math.max(e.breathHz, e.flickerHz), 1.2)
    this.tremolo.depth.rampTo(Math.min(0.85, 0.22 + (e.flickerHz / 4) * 0.55), 1.2)
    // 迟疑的话更闷,笃定的话更透。
    this.filter.frequency.rampTo(500 + e.confidence * 1300, 1.0)

    if (e.toneHz > 0) {
      this.osc.frequency.rampTo(e.toneHz, 0.7)
      const level = TONE_PEAK * e.brightness * (0.35 + 0.65 * e.confidence)
      this.toneGain.gain.rampTo(level, 1.4) // 缓慢吸气般的起音
    } else {
      this.toneGain.gain.rampTo(0, 1.4)
    }

    this.releaseTimer = setTimeout(() => this.rest(), holdMs)
  }

  /** 归于沉默:纯音散去,只剩呼吸床。 */
  rest(): void {
    if (!this.started) return
    this.toneGain.gain.rampTo(0, 3.5) // 像一句话说完后的余音
  }

  /** 基线呼吸的频率变化时(如氛围调整)同步声音的呼吸。 */
  breathe(breathHz: number): void {
    if (!this.started) return
    this.breathLfo.frequency.rampTo(breathHz, 2.0)
    this.tremolo.frequency.rampTo(breathHz, 2.0)
  }
}
