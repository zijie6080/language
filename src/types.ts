// types —— 全局共享类型。层与层之间唯一的通信契约:
// perception → emergence → mapping → expression → memory,单向数据流,任何层不得反向修改他层状态。
//
// 命名铁律:这里没有、也永远不会有 "shapeName" / "label" / "meaning" 之类的字段。
// 意义不在类型里,意义在互动史里。

/**
 * RawSample —— 感知的最小原料:一次指针采样。
 * 这是用户身体动作在数字空间里的原始痕迹,除此之外系统对用户一无所知。
 */
export interface RawSample {
  /** 水平位置,归一化到 [0,1]。用比例而不用像素,让 perception 与任何屏幕尺寸、任何渲染实现解耦。 */
  x: number
  /** 垂直位置,归一化到 [0,1]。同上。 */
  y: number
  /** 采样时刻,毫秒。时间是五种媒介之一(运动)的载体:节奏、快慢、停顿都从 t 的差分里来。 */
  t: number
}

/**
 * FeatureVector —— 一段完整动作(落笔到抬笔)被 perception 压缩成的定长数字指纹。
 * 它刻意只是"数字",不是"形状":emergence 只能看见几何与节奏的统计,永远看不见"圆""线"这类人类词汇。
 */
export interface FeatureVector {
  /**
   * 定长特征数组,长度恒为 FEATURE_DIM。
   * 定长是 emergence 能做距离计算与聚类的前提;每一维的含义由 perception 内部决定,
   * 对下游是黑箱——下游只需要"可比较",不需要"可解释",这正是"无先验"的实现方式。
   */
  vec: number[]
  /** 该动作结束的时刻,毫秒。用于记忆的时间轴:模式何时出现、间隔多久重现,是遗忘与强化的依据。 */
  t: number
}

/**
 * FEATURE_DIM —— 特征向量的维度,perception 与 emergence 之间的数字握手。
 * 双方只共享这一个数,不共享任何语义。
 */
export const FEATURE_DIM = 16

/**
 * Symbol —— emergence 在特征空间里发现的一个稳定模式。
 * 注意它没有名字、没有含义、没有形状描述:它只是"某种反复出现的东西"。
 * 它对人类是什么意思、对渲染呈现成什么样子,分别由互动历史和 mapping 层协商决定,与它本身无关。
 */
export interface Symbol {
  /** 不透明的唯一标识,仅用于跨层引用与语言树记账。刻意用无语义的字符串,防止任何人往 id 里偷藏含义。 */
  id: string
  /** 该模式在特征空间中的质心(长度 FEATURE_DIM)。这是 Symbol 的全部"本体"——一个位置,而不是一个概念。 */
  centroid: number[]
  /** 诞生时刻,毫秒。语言树需要记录每个概念何时被共同创造出来。 */
  born: number
  /** 被观测到的累计次数。重复是意义涌现的最原始信号:出现一次是偶然,反复出现才可能成为词。 */
  count: number
  /**
   * 当前强度 [0,1]。随重现而强化,随冷落而衰减,归零即消亡。
   * 用连续量而不用布尔"存活",让语言像生命体一样有明暗、有呼吸,而不是数据库里的一行记录。
   */
  strength: number
}

/**
 * Expression —— mapping 交给 expression 层的全部渲染指令。
 * 全部是连续物理量,没有任何符号引用:expression 拿到它就能发光、能动、能响,
 * 但永远不知道自己在"说"哪个 Symbol——这就是"渲染不认识 Symbol"的落实。
 * 五种媒介的对应:光(hue/brightness/flicker)、运动(breath)、形态(form)、空间(scatter)、声音(tone)。
 */
export interface Expression {
  /** 色相 [0,1)(HSL 色环)。只是光的一个坐标,不预设"蓝=平静"之类的联想,颜色与感受的关系留给用户自己长出来。 */
  hue: number
  /** 亮度 [0,1]。存在感的强弱:0 近乎隐没,1 灼然可见。 */
  brightness: number
  /** 呼吸频率,Hz。光点持续的胀缩——它不是特效,是"活着"的最低证明,也是这个智能唯一与生俱来的表达。 */
  breathHz: number
  /** 闪烁频率,Hz,0 表示不闪。呼吸之外更急促的光的抖动,可以像犹豫,也可以像兴奋——由互动赋义。 */
  flickerHz: number
  /**
   * 形态参数 [0,1]。一个连续的变形坐标(如从聚拢到伸展),刻意不是枚举:
   * 枚举("circle"/"line")就是偷运人类词汇,连续量才谈得上"前所未有的形态"。
   */
  form: number
  /** 空间离散度 [0,1]。0 凝为一点,1 散布整个黑暗空间。空间即媒介:靠近、退远、弥漫都是话语。 */
  scatter: number
  /** 音高,Hz;0 表示沉默。声音是五媒介之一,同样只给物理量,不给音名、不给和弦这些人类乐理概念。 */
  toneHz: number
  /**
   * 确信度 [0,1]。这个智能对"此刻这样回应"的把握程度。
   * 它不直接是某种视听参数,而是渗透一切的气质:低时迟疑、微弱、试探,高时清晰、笃定。
   */
  confidence: number
}

/**
 * TreeNode —— 语言树上的一个节点:一个被共同创造出来的概念的一生。
 * 树是 memory 层的历史档案,只追记,不回写——任何层都不能通过改树来影响学习。
 */
export interface TreeNode {
  /** 节点自身的唯一标识。 */
  id: string
  /** 指向对应 Symbol 的 id。树记录的是历史,Symbol 是活体;两者分开,概念死后树上仍留痕迹。 */
  symbolId: string
  /** 诞生时刻,毫秒。文明痕迹的第一笔:这个概念是何时被两个智能共同发明的。 */
  born: number
  /** 消亡时刻,毫秒;null 表示仍然活着。死亡也被郑重记录——被遗忘的词也是这门语言的一部分。 */
  died: number | null
}

/**
 * TreeEdge —— 语言树上的一条边:概念之间的血缘。
 * 边只表达"谁从谁那里生长出来",不解释为什么——解释又会变成预设的意义。
 */
export interface TreeEdge {
  /** 父节点 id(较早存在的概念)。 */
  from: string
  /** 子节点 id(在父概念的土壤上分化/衍生出的新概念)。 */
  to: string
  /** 这条血缘被确立的时刻,毫秒。让树的生长本身可以被回放。 */
  born: number
}
