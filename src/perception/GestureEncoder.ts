// GestureEncoder —— 把一次手势(一串归一化 RawSample)编码成定长 FeatureVector。
//
// 这里只有数学,没有识别:没有"圆",没有"三角",没有"直线"。
// 输出的每一维都是几何或节奏的统计量,压缩到相近量纲([0,1] 附近),
// 使 emergence 层可以直接做欧氏距离比较,而无需知道任何一维"是什么"。

import { FEATURE_DIM, type FeatureVector, type RawSample } from '../types'

const EPS = 1e-9

/** 把无界非负量压进 [0,1)。scale 是该量的"典型量级",决定压缩曲线的弯折处。 */
const squash = (v: number, scale: number): number => 1 - Math.exp(-v / scale)

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

const mean = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length

const std = (xs: number[]): number => {
  if (xs.length === 0) return 0
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) * (x - m))))
}

/** 沿弧长等距重采样为 k 个点。曲率统计需要与采样密度、书写速度无关,故先做几何归一化。 */
function resampleByArcLength(pts: RawSample[], k: number): { x: number; y: number }[] {
  const cum: number[] = [0]
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
  }
  const total = cum[cum.length - 1]
  if (total < EPS) return []
  const out: { x: number; y: number }[] = []
  let seg = 0
  for (let j = 0; j < k; j++) {
    const target = (total * j) / (k - 1)
    while (seg < pts.length - 2 && cum[seg + 1] < target) seg++
    const span = cum[seg + 1] - cum[seg]
    const u = span < EPS ? 0 : (target - cum[seg]) / span
    out.push({
      x: pts[seg].x + (pts[seg + 1].x - pts[seg].x) * u,
      y: pts[seg].y + (pts[seg + 1].y - pts[seg].y) * u,
    })
  }
  return out
}

/** 曲率统计所用的重采样点数。只影响统计精度,不进入契约。 */
const RESAMPLE_POINTS = 32
/** 低于此速度(归一化单位/秒)视为停顿。 */
const PAUSE_SPEED = 0.08
/** 短于此时长(毫秒)的低速段不算一次停顿,滤掉采样抖动。 */
const PAUSE_MIN_MS = 80

export class GestureEncoder {
  /**
   * 编码一次完整手势。样本不足或轨迹退化(如原地一点)时,
   * 相应统计量取中性值,依然返回合法的定长向量——沉默与迟疑也是输入。
   */
  encode(samples: RawSample[]): FeatureVector {
    const n = samples.length
    const t = n > 0 ? samples[n - 1].t : 0
    if (n === 0) return { vec: new Array(FEATURE_DIM).fill(0), t }

    const durationMs = samples[n - 1].t - samples[0].t

    // —— 几何:弧长、包围盒、闭合度 ——
    let arcLen = 0
    for (let i = 1; i < n; i++) {
      arcLen += Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y)
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const s of samples) {
      minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x)
      minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y)
    }
    const w = maxX - minX
    const h = maxY - minY
    const diag = Math.hypot(w, h)
    // 宽高占比:0 极扁、1 极窄、0.5 方正;退化(单点)时取中性 0.5。
    const aspect = (w + EPS) / (w + h + 2 * EPS)
    const size = clamp01(Math.max(w, h))
    // 闭合度:首尾距离相对包围盒对角线。0 = 回到起点,1 = 首尾各在一端。
    const endDist = Math.hypot(samples[n - 1].x - samples[0].x, samples[n - 1].y - samples[0].y)
    const closure = clamp01(endDist / (diag + EPS))

    // —— 曲率序列:等弧长重采样后的相邻转角 ——
    const rs = resampleByArcLength(samples, RESAMPLE_POINTS)
    const turns: number[] = []
    for (let i = 1; i < rs.length - 1; i++) {
      const ax = rs[i].x - rs[i - 1].x, ay = rs[i].y - rs[i - 1].y
      const bx = rs[i + 1].x - rs[i].x, by = rs[i + 1].y - rs[i].y
      if (Math.hypot(ax, ay) < EPS || Math.hypot(bx, by) < EPS) continue
      turns.push(Math.atan2(ax * by - ay * bx, ax * bx + ay * by))
    }
    const absTurns = turns.map(Math.abs)
    const meanTurn = squash(mean(absTurns), 0.3)
    const stdTurn = squash(std(turns), 0.5)
    // 净转角(带方向)映射到 [0,1]:0.5 = 不绕,两端 = 绕满一圈以上(顺/逆)。
    const netTurn = (Math.tanh(turns.reduce((a, b) => a + b, 0) / (2 * Math.PI)) + 1) / 2
    // 转向一致性:显著转角中与主方向同号的比例。无显著转角时取中性 0.5。
    const bigTurns = turns.filter((a) => Math.abs(a) > 0.05)
    const domSign = Math.sign(bigTurns.reduce((a, b) => a + b, 0))
    const turnConsistency =
      bigTurns.length === 0 || domSign === 0
        ? 0.5
        : bigTurns.filter((a) => Math.sign(a) === domSign).length / bigTurns.length

    // —— 节奏:速度包络、加速度、停顿 ——
    const speeds: number[] = []
    const speedT: number[] = []
    for (let i = 1; i < n; i++) {
      const dtMs = Math.max(samples[i].t - samples[i - 1].t, 1)
      const d = Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y)
      speeds.push((d / dtMs) * 1000)
      speedT.push((samples[i].t + samples[i - 1].t) / 2)
    }
    const meanSpeed = squash(mean(speeds), 1.5)
    const m = mean(speeds)
    const speedCv = squash(m < EPS ? 0 : std(speeds) / m, 1.5)
    // 速度质心位置:速度沿时间轴的重心落在手势的哪一段。比峰值位置抗噪。
    const speedMass = speeds.reduce((a, b) => a + b, 0)
    let speedCentroid = 0.5
    if (speedMass > EPS && durationMs > EPS) {
      const weighted = speeds.reduce((acc, v, i) => acc + v * (speedT[i] - samples[0].t), 0)
      speedCentroid = clamp01(weighted / speedMass / durationMs)
    }
    const accels: number[] = []
    for (let i = 1; i < speeds.length; i++) {
      const dtSec = Math.max(speedT[i] - speedT[i - 1], 1) / 1000
      accels.push(Math.abs(speeds[i] - speeds[i - 1]) / dtSec)
    }
    const meanAccel = squash(mean(accels), 8)

    // 停顿:速度低于阈值且持续足够久的时间段。
    let pauseMs = 0
    let pauseCount = 0
    let longestPauseMs = 0
    let runMs = 0
    for (let i = 0; i < speeds.length; i++) {
      const dtMs = Math.max(samples[i + 1].t - samples[i].t, 1)
      if (speeds[i] < PAUSE_SPEED) {
        runMs += dtMs
      } else {
        if (runMs >= PAUSE_MIN_MS) {
          pauseCount++
          pauseMs += runMs
          longestPauseMs = Math.max(longestPauseMs, runMs)
        }
        runMs = 0
      }
    }
    if (runMs >= PAUSE_MIN_MS) {
      pauseCount++
      pauseMs += runMs
      longestPauseMs = Math.max(longestPauseMs, runMs)
    }
    const pauseFraction = durationMs > EPS ? clamp01(pauseMs / durationMs) : 0
    const pauseCountSq = squash(pauseCount, 3)
    const longestPause = durationMs > EPS ? clamp01(longestPauseMs / durationMs) : 0

    const vec = [
      squash(arcLen, 2),            // 0  轨迹总长
      closure,                      // 1  闭合度(首尾距离 / 包围盒对角线)
      squash(durationMs, 1500),     // 2  时长
      aspect,                       // 3  包围盒宽高占比
      size,                         // 4  包围盒尺度
      meanTurn,                     // 5  平均转角幅度
      stdTurn,                      // 6  转角波动
      netTurn,                      // 7  净转角(带方向)
      turnConsistency,              // 8  转向一致性
      meanSpeed,                    // 9  平均速度
      speedCv,                      // 10 速度变异系数
      speedCentroid,                // 11 速度质心位置
      meanAccel,                    // 12 平均加速度幅值
      pauseFraction,                // 13 停顿时间占比
      pauseCountSq,                 // 14 停顿次数
      longestPause,                 // 15 最长停顿占比
    ]
    if (vec.length !== FEATURE_DIM) {
      throw new Error(`feature vector length ${vec.length} !== FEATURE_DIM ${FEATURE_DIM}`)
    }
    return { vec, t }
  }
}
