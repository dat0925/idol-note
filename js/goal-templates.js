// =====================================================================
// goal-templates.js — 目標ロードマップの雛形
//
// なぜ SQL(RPC) ではなく JS に置くか:
//   雛形は「増える・書き換わる」ものなので、マイグレーションを1本足さないと
//   1行も直せないのは重い。目標テーブルは家族の誰でも書ける普通のテーブルで、
//   親限定にする理由もない（RLS上の特権が要らない）。
//   ★逆に、権限が絡むもの（家族作成・招待）は今まで通り RPC のままにする。
//
// 使い方:
//   const tree = TEMPLATES.find(t => t.key === 'piano').build({ targetDate });
//   const rows = toRows(tree, { ownerId });   // id はここで採番する
//   await db.insertGoals(rows);               // 1回の upsert で入る
//
// ★ここは「値を組み立てるだけ」の層。DOM も Supabase も触らない。
// =====================================================================
import { monthStart, monthEnd, addMonths, addDays, longDate, jstToday } from './format.js';

// =====================================================================
// ピアノコンクール
//
// 前提にした調べもの:
//   ・カワイピアノコンクールは 予選会 → 地区本選会 → 全国大会 の順。
//     Cコース（小6以下）の予選会課題曲はクーラウ/クレメンティ/ディアベルリの
//     ソナチネで、予選会の優秀賞が本選会への進出ライン。
//     つまり「奨励賞 → 優秀賞」は "本選に行けるかどうか" の壁になる。
//   ・指導側で共通しているのは「本番の1か月前には曲を仕上げる」。
//     そこから先は覚える時間ではなく、磨く時間として使う。
//   ・暗譜は「一応できた」では足りず、本番までの日数を数えながら
//     弾き込む段階まで持っていく必要がある。
//   ・審査で差がつくのはミスの少なさより、拍子感・強弱の設計・音色・曲の構成。
//     ソナチネで奨励賞まで来ている子が次に伸ばすのはここ。
//
// 設計:
//   本番日から逆算して 4か月前〜本番月 の5つの月目標を作る。
//   本番日を変えれば全部ずれるので、来年以降もそのまま使える。
// =====================================================================

/** 本番の何か月前か → その月にやること。行動目標は「今日それをやったか」が分かる粒度にする */
const PIANO_MONTHS = [
  {
    before: 4,
    icon: '🎼',
    title: '土台をつくる（曲を決めて、基礎の型を作る）',
    description: 'ここでの遅れは最後まで取り返せない。曲決めを急ぎ、毎日の基礎練習の形を先に固める。',
    milestone: 0,
    tasks: [
      ['🎯', '先生と課題曲を決める', '候補を3つ出して、次のレッスンで相談して決める。'],
      ['🤲', '毎日ハノンとスケール・アルペジオを10分', '課題曲と同じ調でやる。曲の中で指が迷わなくなる。'],
      ['✏️', '楽譜に指づかいを全部書き込む', '毎回ちがう指で弾くと、本番で必ず止まる。'],
      ['🔢', '楽譜を8小節ごとに区切って番号をふる', '「今日はここ」と決められるようにする。'],
      ['🐢', '片手ずつ ♩=60 で最後まで通す', 'ゆっくり弾くと打鍵がしっかりしてくる。速く弾く練習は後。'],
    ],
  },
  {
    before: 3,
    icon: '📖',
    title: '譜読みを終わらせる（両手で最後まで）',
    description: '速さはまだ気にしない。「止まらずに最後まで行ける」ことだけを目指す。',
    milestone: 0,
    tasks: [
      ['🖐️', '毎日、片手ずつ最後まで1回ずつ通す', '右手・左手それぞれ。まちがえた所は3回やり直す。'],
      ['🙌', '両手でゆっくり最後まで（週3回）', '止まってもいい。最後の音まで行くことを優先する。'],
      ['🔁', 'むずかしい所を3か所えらび、毎日10回ずつ取り出して練習', '曲全体を何回も通すより、できない所だけを繰り返すほうが速い。'],
      ['📝', 'レッスンで直された所をノートに書き、次までに直す', '直してくる子が伸びる。同じ注意を2回もらわない。'],
      ['✅', '月末までに両手で最後まで通す', 'ここが「譜読み完成」のしるし。'],
    ],
  },
  {
    before: 2,
    icon: '🧠',
    title: '暗譜を完成させる（楽譜を閉じて弾く）',
    description: '「一応おぼえた」ではまだヒヤヒヤが残る。どこからでも弾き始められる所まで持っていく。',
    milestone: 1,
    tasks: [
      ['📕', '1日1ページずつ暗譜する', 'そのページだけ楽譜を閉じて弾く。できたら次のページへ。'],
      ['⏱️', '毎日「本番の速さ」で1回通す', 'ゆっくりだけで練習していると、本番の速さで指が回らない。'],
      ['📍', '決めた3か所から弾き始める練習を毎日やる', '本番で止まったとき、そこから戻れる場所を作っておく。'],
      ['🎙️', '週に1回、通しを録音して自分で聴く', '弾いている時には気づけないことが、聴くと分かる。'],
      ['✅', '月末までに楽譜なしで最後まで止まらずに弾く', 'ここが「暗譜完成」のしるし。'],
    ],
  },
  {
    before: 1,
    icon: '🎨',
    title: '表現を仕上げる（本番1か月前に完成させる）',
    description: '奨励賞と優秀賞の差はここ。ミスの少なさではなく、拍子感・強弱の設計・音色で決まる。',
    milestone: 2,
    tasks: [
      ['🖍️', '強弱をどう作るか楽譜に色ペンで書き込む', 'なんとなく大きく・小さくではなく、どこが山かを決める。'],
      ['👏', '拍を口で数えながら1回弾く（毎日）', '拍子感が出ると、同じ音符でも曲に聞こえる。'],
      ['🎩', '家族の前で1日1回、お辞儀から本番のように弾く', '人が見ていると指が変わる。それに慣れておく。'],
      ['🎧', '週に1回、録音を聴いて直す所を1つ決める', '一度に全部直そうとしない。1週間に1つでいい。'],
      ['✅', '月末までに先生から「仕上がった」とOKをもらう', '本番の1か月前に仕上げる。ここから先は磨く時間。'],
    ],
  },
  {
    before: 0,
    icon: '🏆',
    title: '本番で出し切る',
    description: '新しいことはやらない。いつもの力をそのまま出すための準備だけをする。',
    milestone: 3,
    tasks: [
      ['🌅', '毎日、朝いちばんに冷えた指で1回通す', '本番は朝から。あたたまった指でしか弾けない状態にしない。'],
      ['🎹', 'グランドピアノで2回練習する', '家のピアノとは鍵盤の重さも音の響きもちがう。'],
      ['🧘', '弾き始める前のルーティンを毎回やる', '深呼吸 → 手を鍵盤に置く → 心の中で2小節数える。緊張しても同じ手順に入れる。'],
      ['🎒', '前日までに持ち物・服・当日の流れを確認する', '当日の朝に探しものをしない。'],
    ],
  },
];

/** 逆算のチェックポイント。本番1か月前に仕上げる、という定石に合わせてある */
const PIANO_MILESTONES = [
  ['🎼', '曲を決めて、譜読みを終わらせる',
   '両手でゆっくり、止まらずに最後まで行ける状態。指づかいは全部書き込み済み。', 3],
  ['🧠', '暗譜を終わらせて、通しで弾けるようにする',
   '楽譜を閉じて最後まで。決めた場所からいつでも弾き始められる。', 2],
  ['🎨', '表現を仕上げる（本番1か月前に完成）',
   '拍子感・強弱の設計・音色まで作り込む。ここから先は覚える時間ではなく磨く時間。', 1],
  ['🏆', '本番で出し切る',
   '人前・ホール・当日の段取りに慣れて、いつもの力を出せる状態にする。', 0],
];

function buildPiano({ targetDate, today = jstToday() }) {
  const contest = targetDate;

  // 中間目標: 「本番の n か月前の月末」を期限にする（最後の1本だけ本番当日）
  // ★開始日はあとで「配下の月目標のいちばん早い開始日」に揃える。
  //   ここで決め打ちすると、中間目標の棒が配下の月より前から伸びて
  //   チャート上で段が食い違って見える。
  const milestones = PIANO_MILESTONES.map(([icon, title, description, monthsBefore]) => ({
    level: 'milestone',
    icon,
    title,
    description,
    period_start: null,
    period_end: monthsBefore === 0 ? contest : monthEnd(addMonths(contest, -monthsBefore)),
    children: [],
  }));

  for (const m of PIANO_MONTHS) {
    const anchor = addMonths(contest, -m.before);
    // 「今月」は今日から始める。過ぎた日を期間に含めない
    const start = maxDate(today, monthStart(anchor));
    const end = m.before === 0 ? contest : monthEnd(anchor);
    if (end < today) continue;   // 本番日が近すぎて、もう過ぎている月は作らない

    milestones[m.milestone].children.push({
      level: 'month',
      icon: m.icon,
      title: `${Number(anchor.slice(5, 7))}月：${m.title}`,
      description: m.description,
      period_start: start,
      period_end: end,
      children: m.tasks.map(([icon, title, description]) => ({
        level: 'task',
        icon,
        title,
        description,
        period_start: start,
        period_end: end,
        children: [],
      })),
    });
  }

  for (const ms of milestones) {
    if (ms.children.length) ms.period_start = ms.children[0].period_start;
  }

  return {
    level: 'big',
    icon: '🎹',
    title: 'ピアノコンクールで優秀賞をとる',
    description:
      `${longDate(contest)}が本番。奨励賞から一つ上へ。\n`
      + '審査で差がつくのはミスの少なさではなく、拍子感・強弱の設計・音色・曲の構成。\n'
      + '本番の1か月前には仕上げて、そこから先は磨く時間にあてる。',
    period_start: today,
    period_end: contest,
    // 子が1つも無い中間目標（本番が近すぎる場合）は出さない
    children: milestones.filter((m) => m.children.length),
  };
}

// =====================================================================
// アイドルオーディション（元からあった雛形を、同じ形に揃えたもの）
// =====================================================================
function buildIdol({ targetDate, today = jstToday() }) {
  const goal = targetDate;
  const q = (n) => monthEnd(addMonths(today, n));
  return {
    level: 'big',
    icon: '🌟',
    title: 'はじめてのオーディションに挑戦する',
    description: 'まずは家で続けられる練習の習慣をつくり、レッスンを体験し、応募までたどりつく。',
    period_start: today,
    period_end: goal,
    children: [
      ['🔥', '毎日の練習を習慣にする', '短くてもいいので毎日つづける。連続7日・30日をめざす。', 2,
        [['⏰', '毎日15分、時間を決めて練習する', '同じ時間にやると習慣になりやすい。'],
         ['📅', '練習した日をアプリに記録する', '続いていることが目に見えると続く。'],
         ['🔥', '7日連続をまず1回達成する', '30日はそのあと。']]],
      ['🩰', 'レッスンを体験してみる', 'ダンスかボイトレの体験レッスンを2〜3か所うけて、あう先生をさがす。', 5,
        [['🔎', '通える範囲の教室を3つ調べる', '家からの時間と費用も一緒にメモする。'],
         ['📞', '体験レッスンを申し込む', 'まず1つ。行ってみないと分からない。'],
         ['✍️', '体験した感想を書きのこす', '楽しかったか、先生の話が分かったか。']]],
      ['📸', '見せられる形にする', '自己PR文をつくる。写真をとる。歌とダンスを1曲さいごまで通す。', 8,
        [['💬', '自己PRを100文字で書く', '好きなことと、がんばっていることを1つずつ。'],
         ['📷', '全身と顔の写真をとる', '明るい場所で、背景はシンプルに。'],
         ['🎵', '歌とダンスを1曲さいごまで通す', '止まらずに最後まで。']]],
      ['🎬', '応募して本番にのぞむ', '応募先をしらべて、書類をそろえて、オーディションをうける。', 11,
        [['📋', '応募したいところを3つ選ぶ', '年齢の条件と締切を必ず確認する。'],
         ['📨', '書類をそろえて応募する', '締切の1週間前に出す。'],
         ['🎤', '本番の練習を人前でやる', '家族の前で通してみる。']]],
    ].map(([icon, title, description, months, tasks], i, arr) => {
      const start = i === 0 ? today : addDays(q(arr[i - 1][3]), 1);
      const end = q(months);
      return {
        level: 'milestone',
        icon, title, description,
        period_start: start,
        period_end: end,
        children: [{
          level: 'month',
          icon,
          title: `${title}（月の目標）`,
          description,
          period_start: start,
          period_end: end,
          children: tasks.map(([ti, tt, td]) => ({
            level: 'task', icon: ti, title: tt, description: td,
            period_start: start, period_end: end, children: [],
          })),
        }],
      };
    }),
  };
}

// =====================================================================
export const TEMPLATES = [
  {
    key: 'piano',
    icon: '🎹',
    name: 'ピアノコンクールで入賞する',
    summary: '本番の日から逆算して、譜読み → 暗譜 → 表現の仕上げ → 本番 の順に並べます。',
    dateLabel: '本番（コンクール）の日',
    defaultDate: '2026-12-26',
    build: buildPiano,
  },
  {
    key: 'idol',
    icon: '🌟',
    name: 'オーディションに挑戦する',
    summary: '練習の習慣づくり → 体験レッスン → 見せられる形にする → 応募、の4段階です。',
    dateLabel: '目指す時期',
    defaultDate: null,           // 既定は1年後（openTemplate 側で埋める）
    build: buildIdol,
  },
];

/**
 * 雛形のツリーを、そのまま insert できる行の配列にする。
 * ★親を先に並べる。1回の insert 文の中では上から順に行が入るので、
 *   この順番なら子の parent_goal_id の外部キーが必ず満たされる。
 * @param {object} tree build() の戻り値
 * @param {{ownerId?:string}} opts
 */
export function toRows(tree, { ownerId = null } = {}) {
  const rows = [];
  const walk = (node, parentId) => {
    const id = crypto.randomUUID();
    rows.push({
      id,
      parent_goal_id: parentId,
      level: node.level,
      title: node.title,
      description: node.description || '',
      icon: node.icon || '📌',
      owner_user_id: ownerId,
      period_start: node.period_start || null,
      period_end: node.period_end || null,
      progress_pct: 0,
      progress_mode: 'auto',
      status: 'active',
      sort_order: rows.length,
    });
    (node.children || []).forEach((c) => walk(c, id));
  };
  walk(tree, null);
  return rows;
}

// ── 小さな道具 ───────────────────────────────────────
/** 'YYYY-MM-DD' は辞書順＝時系列順なので、そのまま比較してよい */
const maxDate = (a, b) => (a > b ? a : b);
