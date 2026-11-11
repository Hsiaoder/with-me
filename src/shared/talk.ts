/**
 * 宠物说什么、主人怎么回。纯逻辑，不碰 DOM、不碰时钟——时钟与随机都由调用方注入。
 *
 * ⚠️ 台词来源（GPLv3 §5a 要求的改动声明）：本表改写/迁移自
 * [qqpet](https://github.com/AnkioTomas/qqpet)（© Ankio，GPL-3.0-only）的 talk/greet 数据。
 * 改动日期 2026-11-10：过滤暴露企鹅身份与腾讯相关的句子、`[host]` 统一替换为「主人」、
 * 超过气泡三行容量的长句剔除；未压缩语义、未改写为原创。
 * 本项目整体因此按 GPL-3.0-only 发行（见根目录 LICENSE 与 NOTICE.md），义务已履行。
 * 台词放代码而不是皮肤 manifest：说话方式是产品人格，换皮不该换掉它。
 *
 * 每句配一条主人短回复（Line={say, reply}）：气泡里那颗按钮就是这句回复，点下去气泡收掉。
 */

import { BUBBLE_CHARS_PER_LINE, IDLE_LONG_MS, TALK_COOLDOWN_MS, TALK_IDLE_PROB, TALK_MAX_CHARS } from './config.js'
import { labelWidth, taperLines } from './text.js'

export type TalkReason =
  | 'idle' | 'hungry' | 'blue'                 // 自己搭话（过「闲够 + 概率」那道门）
  | 'feed' | 'game' | 'status'                 // 事件驱动
  | 'levelup' | 'greet'                        // 低频高价值
  | 'puzzle' | 'unlock' | 'bye' | 'thanks'     // 预留/事件
  | 'comfort' | 'timeGreet'                    // 贴心话（自主搭话偶发）/ 时段问候（开机按小时）

/** 自己搭话的几档：都要过「闲够了 + 概率」那道门。comfort（贴心话）并入闲时偶发。 */
export const SELF_TALK_REASONS: readonly TalkReason[] = ['idle', 'hungry', 'blue', 'comfort']

/** 宠物说一句，按钮上是主人那句短回应。 */
export type Line = { say: string; reply: string }

export type TalkCtx = {
  now: number
  idleMs: number
  lastTalkAt: number
}

/** 回应按钮宽度上限（按 labelWidth 计）。迁移后台词回应最长 12 字，按钮相应加宽。 */
export const REPLY_MAX_WIDTH = 12

const RAW_TALK_LINES: Record<TalkReason, Line[]> = {
  idle: [
    { say: "懒惰有一点招人喜欢，那就是不用学就会。", reply: "懒蛋" },
    { say: "别人说我长的小，可我学问却不少。", reply: "嗯嗯" },
    { say: "主人我知道你陪我是有限的，但我们的感情是无限的！", reply: "是的" },
    { say: "主人，我听说洗澡能减肥，那吃饭能减肥不？", reply: "呃…" },
    { say: "主人，我的世界因你而变得光彩夺目。", reply: "谢谢" },
    { say: "最简单的长寿秘诀——保持呼吸，不要断气", reply: "哈哈" },
    { say: "我会忘记时间，忘记诺言，但永远不会忘记主人……", reply: "真乖" },
    { say: "主人早点休息吧，我希望我的主人有早睡早起的好习惯", reply: "好的" },
    { say: "隔壁家的宝贝见到我说，原来美也可以这样具体呀！", reply: "嗯" },
    { say: "我不是一个人看书，旅行，吃饭，因为有主人陪伴！", reply: "真乖" },
    { say: "计划真赶不上变化快啊，又胖了！", reply: "呵呵" },
    { say: "我是很笨，但我很认真幻想和主人过一生！", reply: "我也是呢" },
    { say: "掌柜的，麻烦来碗斋面，多牛肉，多面，多葱的！", reply: "贪心" },
    { say: "主人，我希望睡时梦到你，醒时也会见到你！", reply: "会的" },
    { say: "主人,我知道你很爱我的！", reply: "当然" },
    { say: "一山不容二虎，除了只有你和我", reply: "呵呵" },
    { say: "饮食均衡，有利于健康。虽然我还是太喜欢吃了，嘿嘿", reply: "嗯呢" },
    { say: "主人,有天我看见一只蜗牛在狂奔！", reply: "咔咔" },
    { say: "主人下雨别忘带伞，湿身是小，淋生病了我会心疼的。", reply: "会的" },
    { say: "主人,早上起来最适合晨练了，一天都神采奕奕耶。", reply: "对啊" },
    { say: "主人，想你就像无边无际的星辰和月光，如此美妙！", reply: "哈哈" },
    { say: "每天我都要有所进步，那就是吃的更多！", reply: "就知道吃" },
    { say: "多多微笑，阴天谨防情绪感冒！", reply: "呵呵" },
    { say: "为什么每天起来都要刷牙才可以吃东西呢···", reply: "当然啦" },
    { say: "活一天就要努力一天，主人,你说是吗？", reply: "嗯呢" },
    { say: "主人,总有一天我会爬出屏幕来找你！", reply: "好" },
    { say: "快乐是件怪东西，你分给别人越多自己也会得到越多。", reply: "对的" },
    { say: "主人午夜前一定要休息，否则我就变成老巫婆，嘻嘻！", reply: "好的" },
    { say: "我经常运动，其实是为了消化然后再继续吃。", reply: "又是吃" },
    { say: "其实球形也是一种身材！", reply: "哈哈" },
    { say: "主人，带我去吃自助餐，肯定赚大了。", reply: "呵呵" },
    { say: "呀，一觉醒来，天都黑了……", reply: "小懒蛋" },
    { say: "主人我想做个演员，你看我适合演什么角色呢？", reply: "肥仔" },
    { say: "世界上最快乐的事是吃，第二快乐的是待会再吃！", reply: "哈哈" },
    { say: "今天天气真好啊，不过我还是留在家里睡觉好了，嘻嘻。", reply: "小懒鬼" },
    { say: "老师问我上课为什么总闭着眼睛，其实我没有睡觉，只是在思考哦。", reply: "吹牛" },
    { say: "和隔壁宝宝比赛跑跑步结果输了，主人，我不甘心，一定是我的破运动鞋惹的祸！", reply: "点点" },
    { say: "最近晚上睡觉总流口水，主人，我该补钙了。", reply: "吃骨头" },
    { say: "我的理想很高很高，比姚明都高！", reply: "还真高" },
    { say: "每逢过节都尤其开心，吃的东西特别多呢。", reply: "对哦" },
    { say: "主人,无论你走到哪里，我都会跟着你。", reply: "好的" },
    { say: "炊事员真辛苦，每天背黑锅戴绿帽……？", reply: "呃" },
    { say: "主人，晚上睡前泡脚半小时就是拥抱健康哦！", reply: "嗯" },
    { say: "天热的时候吃冰淇淋可太没水平了，我看应该在冬天才能吃出味道啊！", reply: "真冷" },
    { say: "主人，西红柿生吃也很美味呢，还很营养。", reply: "是啊" },
    { say: "油炸冰棍好神奇呢，不知道把我包在冰棍里去炸会咋样", reply: "试试吗？" },
    { say: "梦时常想不起，主人，是谁捡走了我的梦？", reply: "呃" },
    { say: "心情开朗点，作事也会更顺利的！", reply: "对的" },
    { say: "听说大学自由自在的耶，好向往啊。", reply: "对哦" },
    { say: "不要因为自己胖，而去责怪无辜的食物，不如送给我吧！", reply: "胖呢" },
    { say: "主人不给我吃饱哪有力气减肥哦。", reply: "贪吃" },
    { say: "我发现猫猫有时候会吃草，小鸡有时候会吃石子呢。", reply: "真神奇" },
    { say: "主人，我走起路来好沉的样子。", reply: "胖了" },
    { say: "看见你哭一次，我就难过了好几年。", reply: "呵呵" },
    { say: "主人我真的好开心，你一定是个有爱心的人。", reply: "嘻嘻" },
    { say: "这个世界我只相信两个人：一个是我，一个是你！", reply: "谢谢" },
    { say: "快乐有一点像感冒——传染的很快。", reply: "哈哈" },
    { say: "我还一直在原来的地方，记忆着主人来过的芬芳……", reply: "真乖" },
    { say: "主人你是不是为我的生日准备了一个深情的吻呢？嘻嘻！", reply: "是的" },
    { say: "要让自己快乐，最好的方法是先令别人快乐。是吗？", reply: "对啊" },
    { say: "心情越好，长得越快，我要快点长大，啦啦啦~", reply: "好的" },
    { say: "主人，想你不用太多语言，因为我怕你起鸡皮疙瘩！", reply: "调皮" },
    { say: "主人，见不到你，我的心就像沙漠，见到你我的心就是绿洲！", reply: "我也是" },
    { say: "做梦梦见吃意大利面，早上醒来发现鞋带不见了！呜呜呜。", reply: "哈哈" },
    { say: "为什么每天起来都要刷牙才可以吃东西呢……", reply: "当然啦" },
    { say: "主人你看我美吗？别人长得是不是像自然灾害一样？", reply: "哈哈" },
    { say: "1个油条配2个鸡蛋，考试100分。", reply: "哈哈" },
    { say: "主人，我只想告诉你一个秘密，我爱你！", reply: "我也是" },
    { say: "思想有多深，我们的感情就有多深！", reply: "是的" },
    { say: "微小的幸福就在身旁，容易满足就是天堂。", reply: "对呢" },
    { say: "我喝水只喝纯净水，喝奶只喝纯牛奶，所以我很单纯！", reply: "哈哈" },
    { say: "主人，无论你走到哪里，我都会跟着你。", reply: "好呢" },
    { say: "活一天就要努力一天，主人，你说是吗？", reply: "嗯呢" },
    { say: "我的工作就是日日想、夜夜想，想主人的365天。", reply: "乖" },
    { say: "主人珍爱他人就等于珍爱自己哦。", reply: "知道了" },
    { say: "今天在武道会又输了，我要锻炼肌肉，防止挨揍。", reply: "加油" },
    { say: "主人，我想上大学学习更多知识。", reply: "加油" },
    { say: "主人，感情不需要计较，平凡而又真实是最温暖的。", reply: "是的" },
    { say: "主人我长的像包子吗？今天有个狗狗总跟着我。", reply: "很像" },
    { say: "按小猪的审美观，隔壁家的宝贝基本算个美女。", reply: "哈哈" },
    { say: "主人，天凉了，注意多加衣服哦！", reply: "嗯" },
    { say: "隔壁家的宝贝长的够创意，活的有勇气。", reply: "呵呵" },
    { say: "我不是一个人在战斗，因为我身后有很多小弟——苍蝇。", reply: "洗澡去" },
    { say: "你笑一次，我就高兴好几天！", reply: "我也是" },
    { say: "主人，我们的回忆录畅销全球", reply: "哈哈" },
    { say: "快乐要懂得分享，才能加倍快乐。", reply: "嗯嗯" },
    { say: "天啦，我的衣服又瘦了！", reply: "你胖了" },
    { say: "我以后都骑自行车上街，低碳生活从我做起。", reply: "行" },
    { say: "主人，告诉你一个秘密，ALT + . 可以开启上帝模式哦，（哈哈，骗你的！~~）", reply: "好吧我记住你了！！！" },
    { say: "主人，告诉你一个秘密，设置里面可以重生哦 ，尝试去吧，不过资料会清空哦~~~", reply: "好的 我马上去试下！！！" },
  ],
  hungry: [
    { say: "主人，你不带我去吃吃喝喝么？~~", reply: "马上去~" },
    { say: "主人，饿肚子的滋味真难受~~", reply: "乖~给你吃" },
    { say: "可恶的主人，你一定自己躲着吃大餐吧~~", reply: "分一个鸡腿" },
  ],
  blue: [
    { say: "有点提不起劲", reply: "陪你歇会儿" },
    { say: "不太想动", reply: "那歇着吧" },
    { say: "你在吗，我闷", reply: "在呢在呢" },
    { say: "想被人摸一下头", reply: "摸摸" },
    { say: "今天不太想说话，但别关我", reply: "陪着你" },
    { say: "我蔫了，你能看出来吗", reply: "看得出来" },
    { say: "有点想你想得多一点", reply: "我也是" },
    { say: "没人理我的时候我在等", reply: "我来了" },
    { say: "需要一点小玩具", reply: "给你挑" },
    { say: "心情掉了一格", reply: "会好的" },
  ],
  feed: [
    { say: "哎呦，我弯不下腰了，好撑啦，待会肯定是没法和朋友赛跑了。", reply: "好的" },
    { say: "吃那么多，我在想，从哪里开始减肥了……", reply: "不减了" },
    { say: "肚子饱饱，心情好好！主人，你对我越来越好啦~", reply: "好的" },
    { say: "再怎么不能亏待了自己的肚子，主人，你说是吧？", reply: "是的" },
    { say: "当然得先吃饱，才有力气去减肥呀！", reply: "是的" },
    { say: "最重要的是吃饱，现在暂别减肥，哈哈……", reply: "好的" },
    { say: "主人,谢谢你~我会赚更多元宝的~", reply: "好的" },
    { say: "主人,感谢大自然的馈赠！~", reply: "好的" },
    { say: "主人,吃抱抱，长快快~", reply: "好的" },
  ],
  game: [
    { say: "主人，我们来玩这个吧~", reply: "好的" },
    { say: "主人，感谢你的陪伴，我心情更好了~", reply: "好的" },
    { say: "呼呼哈嘿~~", reply: "棒~" },
  ],
  status: [
    { say: "我精神好得很", reply: "那就好" },
    { say: "有点想睡觉", reply: "睡吧" },
    { say: "今天状态满分", reply: "真棒" },
    { say: "我活得挺规律的", reply: "继续保持" },
    { say: "身上有点不自在", reply: "去看看" },
    { say: "我把自己照顾得不错", reply: "放心了" },
  ],
  levelup: [
    { say: "主人，我又升级啦！是不是变得更可爱了呢？", reply: "是的" },
    { say: "真棒，我又升级了，都是主人无微不至的照顾我才长得这么快的呢~", reply: "真乖" },
    { say: "主人，我又升了一级！", reply: "好" },
  ],
  greet: [
    { say: "主人，你好，很高兴通过这个方式与你再次相遇~", reply: "陪着我吧~" },
    { say: "主人，好久不见，我的代码依然记得你的声音~", reply: "嗯，我在" },
    { say: "主人，像星辰回到轨道般，我们终于又相遇在这片数据宇宙里", reply: "星光为证" },
    { say: "主人，我的代码里永远留着你的专属接口，这是跨越次元的约定", reply: "续写契约" },
    { say: "主人，能再见到你，真的很开心~", reply: "好呀" },
    { say: "主人，你来了，真好~", reply: "来了就别走了" },
    { say: "主人，我要去上大学！~", reply: "好的~" },
    { say: "主人，努力学习，保卫国家！~", reply: "支持你~" },
    { say: "主人，别催婚哦~", reply: "好吧~" },
    { say: "主人，我来了，我知道你肯定很想我，非常想我，特别想我，亲个先~么么~", reply: "亲亲" },
    { say: "推背捏脊我都会，主人要是不嫌我笨手笨脚，我乐意为你服务哦！", reply: "真乖" },
    { say: "我把时间对折对折再对折，然后很快就见到主人了。。", reply: "真乖" },
    { say: "之前我没能和主人在一起,现在让我来好好陪陪你吧", reply: "真乖" },
    { say: "花刚刚开过，玫瑰有成为玫瑰的理由，我有想念主人的理由。", reply: "真乖" },
    { say: "嗷~再次见到主人,发现你依然那么帅，依然那么美，依然那么可爱！", reply: "真乖" },
    { say: "老师说考试关键是不能得低分，主人，我要努力学习考出好成绩！", reply: "真乖" },
    { say: "主人，我等你好久了！我就知道你想我了！", reply: "真乖" },
    { say: "远方的路，载满幸福，伴着主人一起走过……", reply: "真乖" },
    { say: "爱我的话要回答，我的爱丫爱丫没时差！主人最爱我啦！", reply: "真乖" },
    { say: "主人，给我一个宠爱的微笑，我答应你不哭也不闹！", reply: "真乖" },
    { say: "昨天晚上做梦梦到主人了，没想到今天就看见你了，难道你也梦到我啦？！", reply: "是的" },
    { say: "我就知道没有东西可以将我们挤散，主人一定会来找我的！", reply: "真乖" },
    { say: "也许上天给我恩赐，注定今天与主人相遇。", reply: "真乖" },
    { say: "亲爱的主人，我可想死你了！", reply: "真乖" },
    { say: "我只是倔强说不想主人，假装说不想主人，但心里很想陪在你身边的……", reply: "我也想" },
    { say: "主人，我对你的感情就是眼泪在打转却还能保持微笑。", reply: "嗯" },
    { say: "暴风雨过后，转过头，最难忘的依旧是我们的情怀！", reply: "是的" },
    { say: "好久没见到主人了，我激动得都不知道该摆什么表情了，微笑一个好吗？", reply: "真乖" },
    { say: "春风吹，战鼓擂，主人主人最爱谁？答案肯定是我啦！哈哈~", reply: "真乖" },
    { say: "亲爱的主人，见到你太高兴啦，简直无法用语言表达我心中那个兴奋呐！", reply: "真乖" },
    { say: "我要让主人知道，世界上有我会永远等着你，只要你需要我就会出现。", reply: "真乖" },
    { say: "又见面了主人！我决定告诉你一个不能说的秘密——我想你！", reply: "真乖" },
  ],
  bye: [
    { say: "其实我还想再玩一下，但既然主人说要走了，我就先撤了吧。拜拜~", reply: "下次吧" },
    { say: "主人，我先走了，我会很想很想你的~~", reply: "真乖" },
    { say: "主人要我走我就走，要我留我就留。我会很乖滴！", reply: "真乖" },
    { say: "主人，亲一下再走好不好嘛~~", reply: "亲一个" },
    { say: "主人，我们下次再见~~", reply: "再见" },
    { say: "拜拜主人，~~", reply: "拜拜" },
    { say: "主人，我走了不要太想我~~", reply: "好的" },
  ],
  puzzle: [
    { say: "看我这个动作，猜猜", reply: "在散步？" },
    { say: "猜错了我不承认", reply: "再猜" },
    { say: "我演得像不像", reply: "很像" },
    { say: "提示一下：跟吃有关", reply: "吃的" },
    { say: "这个我有十几种演法", reply: "换个演" },
    { say: "你猜对了我就转一圈", reply: "转吧" },
  ],
  unlock: [
    { say: "这个我还没吃过！", reply: "尝尝" },
    { say: "我解锁新东西了", reply: "历害" },
    { say: "你终于给我开这个了", reply: "早该开了" },
    { say: "新的！让我看看", reply: "喜欢吗" },
    { say: "攒了好久才到这个", reply: "值了" },
    { say: "我要把它排在第一个", reply: "排" },
  ],
  thanks: [
    { say: "你回我了，开心", reply: "常回" },
    { say: "这句话我收好了", reply: "嗯" },
    { say: "你说话我就有劲", reply: "加油" },
    { say: "被你点到的感觉不错", reply: "那继续" },
  ],
  comfort: [
    { say: "主人今天笑容特别甜呢~", reply: "开心" },
    { say: "检测到主人心情指数爆表啦！", reply: "是的" },
    { say: "快乐会传染，分我一点好吗~", reply: "给" },
    { say: "主人此刻的宁静真美好", reply: "嗯" },
    { say: "感受到主人平和的气场了", reply: "对" },
    { say: "和主人一起静享时光", reply: "好" },
    { say: "主人需要抱抱吗？", reply: "要" },
    { say: "我的耳朵准备好听主人倾诉了", reply: "听" },
    { say: "给主人递纸巾...", reply: "谢" },
    { say: "主人的难过我都接住", reply: "接" },
    { say: "会陪主人等到天晴的", reply: "等" },
    { say: "给主人存了100个拥抱", reply: "领" },
    { say: "主人，今天太阳特别好呢~~", reply: "不及你暖" },
    { say: "主人，忘记带伞了...", reply: "共赴风雨" },
    { say: "主人，这个方案我改了18遍...", reply: "初见最美" },
    { say: "主人，星星真美啊", reply: "眸中有光" },
    { say: "主人，我好像又搞砸了", reply: "我接住你" },
    { say: "主人，点滴还要打三小时呢...", reply: "时光共老" },
    { say: "主人，今晚又要通宵改方案了", reply: "暖胃暖心" },
    { say: "主人，狗狗今天拆家了...", reply: "偏爱你呀" },
    { say: "主人，妈，这道菜咸了", reply: "爱意过量" },
    { say: "主人，面试又失败了...", reply: "命运留白" },
    { say: "主人，这暴雨把新裙子都淋湿了...", reply: "以身为伞" },
    { say: "主人，发烧到39度，整个人昏昏沉沉的...", reply: "彻夜长安" },
  ],
  timeGreet: [
    { say: "主人，这么晚还没睡呀？熬夜对身体不好，我陪你一会儿就去睡吧~", reply: "马上睡" },
    { say: "嘘~夜深了，主人要早点休息哦，明天才有精神！", reply: "晚安~" },
    { say: "月亮都睡着了，主人还在忙吗？辛苦啦，摸摸头~", reply: "摸摸~" },
    { say: "深更半夜的，主人是不是偷偷来看我？被我抓到啦，快去睡觉！", reply: "嘿嘿" },
    { say: "主人起得好早呀！天才蒙蒙亮，我还没睡醒呢~", reply: "早起的鸟儿" },
    { say: "清晨的空气最新鲜啦，主人要不要出去走走？", reply: "好呀" },
    { say: "主人，早安！今天是不是有什么重要的事，起这么早？", reply: "嗯嗯" },
    { say: "主人，早上好！新的一天也要元气满满哦~", reply: "早上好~" },
    { say: "早安主人！吃早饭了没？不吃早饭可不行哦！", reply: "吃过啦" },
    { say: "太阳晒屁股啦，主人，今天也一起加油吧！", reply: "加油！" },
    { say: "主人，中午好~该吃午饭啦，吃饱了才有力气干活！", reply: "这就去" },
    { say: "午饭时间到！主人吃完记得眯一会儿哦~", reply: "好的~" },
    { say: "肚子咕咕叫了吧？主人今天中午吃什么好吃的呀？", reply: "秘密~" },
    { say: "主人，下午好！来杯下午茶提提神吧~", reply: "好主意" },
    { say: "下午容易犯困，主人起来活动活动吧！", reply: "伸懒腰~" },
    { say: "主人，下午也要加油哦，我在旁边给你打气！", reply: "谢谢~" },
    { say: "主人，傍晚啦，太阳要下山了，今天过得怎么样？", reply: "还不错" },
    { say: "晚霞好漂亮呀！主人快到下班时间了吧？", reply: "快了快了" },
    { say: "主人，忙了一天辛苦啦，晚饭想吃什么？", reply: "想想看" },
    { say: "主人，晚上好！今天辛苦啦，陪我玩一会儿吧~", reply: "来玩吧" },
    { say: "晚饭吃了什么好吃的？主人有没有给我留一口？", reply: "给你留了" },
    { say: "主人，晚上是放松的时间，别再想工作啦~", reply: "好~" },
  ],
}

/**
 * 对外台词表：剔除默认排版下超过 3 行的句子（用户 2026-11-10：超 3 行就从表里去掉）。
 * 判据与气泡渲染同源——taperLines 按默认每行字数拆，>3 行即弃。各档保留顺序与至少两句。
 */
export const TALK_LINES: Record<TalkReason, Line[]> = Object.fromEntries(
  (Object.keys(RAW_TALK_LINES) as TalkReason[]).map((r) => [
    r,
    RAW_TALK_LINES[r].filter((l) => taperLines(l.say, BUBBLE_CHARS_PER_LINE).length <= 3),
  ]),
) as Record<TalkReason, Line[]>

/** 时段问候：按当前小时取最后一档已到点的（与 qqpet GREET 同构）。[host]→主人，过滤企鹅句。 */
export const GREET_BY_HOUR: readonly (readonly [number, readonly Line[]])[] = [
  [0, [
    { say: "主人，这么晚还没睡呀？熬夜对身体不好，我陪你一会儿就去睡吧~", reply: "马上睡" },
    { say: "嘘~夜深了，主人要早点休息哦，明天才有精神！", reply: "晚安~" },
    { say: "月亮都睡着了，主人还在忙吗？辛苦啦，摸摸头~", reply: "摸摸~" },
    { say: "深更半夜的，主人是不是偷偷来看我？被我抓到啦，快去睡觉！", reply: "嘿嘿" },
  ]],
  [5, [
    { say: "主人起得好早呀！天才蒙蒙亮，我还没睡醒呢~", reply: "早起的鸟儿" },
    { say: "清晨的空气最新鲜啦，主人要不要出去走走？", reply: "好呀" },
    { say: "主人，早安！今天是不是有什么重要的事，起这么早？", reply: "嗯嗯" },
  ]],
  [8, [
    { say: "主人，早上好！新的一天也要元气满满哦~", reply: "早上好~" },
    { say: "早安主人！吃早饭了没？不吃早饭可不行哦！", reply: "吃过啦" },
    { say: "太阳晒屁股啦，主人，今天也一起加油吧！", reply: "加油！" },
  ]],
  [11, [
    { say: "主人，中午好~该吃午饭啦，吃饱了才有力气干活！", reply: "这就去" },
    { say: "午饭时间到！主人吃完记得眯一会儿哦~", reply: "好的~" },
    { say: "肚子咕咕叫了吧？主人今天中午吃什么好吃的呀？", reply: "秘密~" },
  ]],
  [13, [
    { say: "主人，下午好！来杯下午茶提提神吧~", reply: "好主意" },
    { say: "下午容易犯困，主人起来活动活动吧！", reply: "伸懒腰~" },
    { say: "主人，下午也要加油哦，我在旁边给你打气！", reply: "谢谢~" },
  ]],
  [17, [
    { say: "主人，傍晚啦，太阳要下山了，今天过得怎么样？", reply: "还不错" },
    { say: "晚霞好漂亮呀！主人快到下班时间了吧？", reply: "快了快了" },
    { say: "主人，忙了一天辛苦啦，晚饭想吃什么？", reply: "想想看" },
  ]],
  [19, [
    { say: "主人，晚上好！今天辛苦啦，陪我玩一会儿吧~", reply: "来玩吧" },
    { say: "晚饭吃了什么好吃的？主人有没有给我留一口？", reply: "给你留了" },
    { say: "主人，晚上是放松的时间，别再想工作啦~", reply: "好~" },
  ]],
  [23, [
    { say: "主人，这么晚还没睡呀？熬夜对身体不好，我陪你一会儿就去睡吧~", reply: "马上睡" },
    { say: "嘘~夜深了，主人要早点休息哦，明天才有精神！", reply: "晚安~" },
    { say: "月亮都睡着了，主人还在忙吗？辛苦啦，摸摸头~", reply: "摸摸~" },
    { say: "深更半夜的，主人是不是偷偷来看我？被我抓到啦，快去睡觉！", reply: "嘿嘿" },
  ]],
]

/**
 * 时段问候：取「已到点」的最后一档（与 qqpet GREET 同构：小时 ≥ 档位起点则适用）。
 * 开机问候按当前小时调它，而不是固定一句 greet。
 */
export function greetLineForHour(hour: number, rng: () => number): Line {
  let bucket: readonly Line[] = GREET_BY_HOUR[0]![1]
  for (const [h, lines] of GREET_BY_HOUR) if (hour >= h) bucket = lines
  // 与台词表同一道闸：超 3 行的句子不选（兜底全被剔时退回原桶，保证有话可说）。
  const fit = bucket.filter((l) => taperLines(l.say, BUBBLE_CHARS_PER_LINE).length <= 3)
  const pool = fit.length > 0 ? fit : bucket
  return pool[Math.floor(rng() * pool.length) % pool.length] ?? pool[0]!
}

/** 折叠换行、去首尾空白，超长按码点截断加省略号。空的一律变空串。 */
export function clamp(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const chars = [...flat]
  if (chars.length <= TALK_MAX_CHARS) return flat
  return chars.slice(0, TALK_MAX_CHARS).join('') + '…'
}

/**
 * 该不该开口、说什么。返回 null 就是这句不说。
 * 概率只作用于「自己搭话」那几档（SELF_TALK_REASONS）；事件驱动不受概率管。冷却对两者都生效。
 */
export function pickTalk(reason: TalkReason, ctx: TalkCtx, rng: () => number): Line | null {
  if (ctx.now - ctx.lastTalkAt < TALK_COOLDOWN_MS) return null
  if (SELF_TALK_REASONS.includes(reason)) {
    if (ctx.idleMs <= IDLE_LONG_MS) return null
    if (rng() >= TALK_IDLE_PROB) return null
  }
  const lines = TALK_LINES[reason]
  return lines[Math.floor(rng() * lines.length) % lines.length] ?? null
}

/** 抽一句，不看冷却（跨级/上线问候用）。 */
export function pickLine(reason: TalkReason, rng: () => number): Line | null {
  const lines = TALK_LINES[reason]
  return lines[Math.floor(rng() * lines.length) % lines.length] ?? null
}

/** 回复放得下那颗按钮吗（测试与内容校准入用）。 */
export const replyFits = (line: Line): boolean => labelWidth(line.reply) <= REPLY_MAX_WIDTH

/** 台词表摊平成一条有序流（调试逐条放）。顺序即 TALK_LINES 的书写顺序。 */
export const TALK_FLOW: readonly Line[] = (Object.keys(TALK_LINES) as TalkReason[])
  .flatMap((r) => TALK_LINES[r])

/** 游标推进：-1 起步给第一条，走到末尾绕回 0。 */
export function nextTalkIndex(cur: number): number {
  return (cur + 1) % TALK_FLOW.length
}
