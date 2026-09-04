/* 搜尋核心 —— server（Node）同 iPad（瀏覽器）共用同一套邏輯同詞庫，
 * 咁「本機 server 版」同「靜態版」搜出嚟嘅嘢先會一模一樣。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SearchCore = factory();
}(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  /* ---------- 中英對照詞庫 ---------- */
  /* 格式：[中文主詞, [其他中文叫法...], [英文...]]，兩邊互相展開 */
  const RAW = [
    // 奶類・蛋・豆品
    ['牛奶', ['鮮奶', '奶'], ['milk', 'fresh milk', 'dairy']],
    ['全脂奶', ['全脂牛奶'], ['whole milk', 'full cream milk']],
    ['低脂奶', ['脫脂奶'], ['low fat milk', 'skim milk', 'skimmed milk']],
    ['朱古力奶', [], ['chocolate milk']],
    ['豆漿', ['豆奶'], ['soy milk', 'soya milk']],
    ['燕麥奶', [], ['oat milk']],
    ['杏仁奶', [], ['almond milk']],
    ['忌廉', ['奶油'], ['cream', 'whipping cream']],
    ['芝士', ['起司'], ['cheese']],
    ['牛油', [], ['butter']],
    ['乳酪', ['酸奶'], ['yogurt', 'yoghurt']],
    ['雞蛋', ['蛋'], ['egg', 'eggs']],
    ['豆腐', [], ['tofu', 'bean curd']],
    ['煉奶', ['淡奶'], ['condensed milk', 'evaporated milk']],

    // 麵包・早餐・穀物
    ['麵包', ['方包', '包'], ['bread', 'loaf']],
    ['多士', ['吐司'], ['toast']],
    ['麥片', ['燕麥'], ['cereal', 'oatmeal', 'oats', 'granola']],
    ['蜜糖', ['蜂蜜'], ['honey']],
    ['果醬', [], ['jam', 'marmalade']],
    ['花生醬', [], ['peanut butter']],
    ['咖啡', [], ['coffee']],
    ['咖啡豆', [], ['coffee beans']],
    ['茶包', ['茶'], ['tea', 'tea bag']],
    ['奶茶', [], ['milk tea']],
    ['阿華田', ['好立克'], ['ovaltine', 'horlicks']],

    // 米・麵・油・調味
    ['米', ['白米', '珍珠米'], ['rice']],
    ['糙米', [], ['brown rice']],
    ['意粉', ['意大利粉'], ['pasta', 'spaghetti']],
    ['麵', ['麵條'], ['noodle', 'noodles']],
    ['公仔麵', ['即食麵', '出前一丁'], ['instant noodle', 'instant noodles', 'ramen']],
    ['米粉', ['米線'], ['rice noodle', 'vermicelli']],
    ['麵粉', [], ['flour']],
    ['食油', ['油'], ['oil', 'cooking oil']],
    ['橄欖油', [], ['olive oil']],
    ['麻油', ['芝麻油'], ['sesame oil']],
    ['豉油', ['醬油', '生抽', '老抽'], ['soy sauce', 'soya sauce']],
    ['蠔油', [], ['oyster sauce']],
    ['醋', [], ['vinegar']],
    ['鹽', [], ['salt']],
    ['糖', ['砂糖', '白糖'], ['sugar']],
    ['胡椒', ['胡椒粉'], ['pepper']],
    ['茄汁', ['番茄醬'], ['ketchup', 'tomato sauce']],
    ['沙律醬', ['蛋黃醬'], ['mayonnaise', 'mayo']],
    ['芥辣', ['芥末'], ['mustard', 'wasabi']],
    ['辣椒醬', ['辣醬'], ['chili sauce', 'hot sauce', 'sriracha']],
    ['咖喱', [], ['curry']],
    ['湯', ['湯料', '湯包'], ['soup']],
    ['雞湯', ['上湯'], ['chicken broth', 'stock']],

    // 肉・海鮮
    ['豬肉', ['豬'], ['pork']],
    ['牛肉', ['牛'], ['beef']],
    ['雞肉', ['雞'], ['chicken']],
    ['雞胸', ['雞柳'], ['chicken breast']],
    ['雞翼', [], ['chicken wing', 'chicken wings']],
    ['羊肉', [], ['lamb', 'mutton']],
    ['免治肉', ['碎肉'], ['minced meat', 'ground meat']],
    ['煙肉', [], ['bacon']],
    ['香腸', ['腸仔'], ['sausage']],
    ['火腿', [], ['ham']],
    ['魚', ['鮮魚'], ['fish']],
    ['三文魚', [], ['salmon']],
    ['吞拿魚', [], ['tuna']],
    ['蝦', [], ['shrimp', 'prawn']],
    ['蟹', [], ['crab']],
    ['魚柳', [], ['fish fillet']],

    // 蔬果
    ['蔬菜', ['菜'], ['vegetable', 'vegetables', 'veggie']],
    ['生菜', [], ['lettuce']],
    ['菜心', ['白菜', '芥蘭'], ['choy sum', 'pak choi', 'bok choy']],
    ['西蘭花', [], ['broccoli']],
    ['蕃茄', ['番茄', '西紅柿'], ['tomato', 'tomatoes']],
    ['薯仔', ['馬鈴薯'], ['potato', 'potatoes']],
    ['紅蘿蔔', ['甘筍'], ['carrot', 'carrots']],
    ['洋蔥', [], ['onion', 'onions']],
    ['蒜頭', ['蒜'], ['garlic']],
    ['薑', [], ['ginger']],
    ['青瓜', ['黃瓜'], ['cucumber']],
    ['粟米', ['玉米'], ['corn', 'sweet corn']],
    ['蘑菇', ['冬菇', '菇'], ['mushroom', 'mushrooms']],
    ['菠菜', [], ['spinach']],
    ['椰菜', [], ['cabbage']],
    ['南瓜', [], ['pumpkin']],
    ['茄子', [], ['eggplant', 'aubergine']],
    ['水果', ['生果'], ['fruit', 'fruits']],
    ['蘋果', [], ['apple', 'apples']],
    ['香蕉', [], ['banana', 'bananas']],
    ['橙', [], ['orange', 'oranges']],
    ['提子', ['葡萄'], ['grape', 'grapes']],
    ['士多啤梨', ['草莓'], ['strawberry', 'strawberries']],
    ['藍莓', [], ['blueberry', 'blueberries']],
    ['西瓜', [], ['watermelon']],
    ['芒果', [], ['mango']],
    ['奇異果', [], ['kiwi']],
    ['檸檬', [], ['lemon', 'lime']],
    ['牛油果', [], ['avocado']],
    ['菠蘿', ['鳳梨'], ['pineapple']],
    ['梨', ['雪梨'], ['pear']],
    ['桃', ['蜜桃'], ['peach']],
    ['車厘子', [], ['cherry', 'cherries']],

    // 飲品
    ['水', ['蒸餾水', '礦泉水'], ['water', 'distilled water', 'mineral water']],
    ['汽水', [], ['soda', 'soft drink']],
    ['可樂', [], ['coke', 'cola', 'coca cola']],
    ['果汁', ['橙汁'], ['juice', 'orange juice']],
    ['啤酒', [], ['beer']],
    ['紅酒', ['葡萄酒'], ['wine', 'red wine']],
    ['白酒', [], ['white wine']],
    ['能量飲品', ['運動飲品'], ['energy drink', 'sports drink']],
    ['豆漿飲品', ['維他奶'], ['vitasoy']],

    // 零食
    ['零食', ['小食'], ['snack', 'snacks']],
    ['薯片', [], ['chips', 'potato chips', 'crisps']],
    ['朱古力', ['巧克力'], ['chocolate']],
    ['餅乾', ['曲奇', '餅'], ['biscuit', 'cookie', 'cookies', 'cracker']],
    ['糖果', [], ['candy', 'sweets']],
    ['雪糕', ['冰淇淋'], ['ice cream']],
    ['果仁', ['堅果'], ['nuts', 'almond', 'cashew']],
    ['布丁', ['啫喱'], ['pudding', 'jelly']],
    ['爆谷', [], ['popcorn']],

    // 罐頭・急凍
    ['罐頭', [], ['can', 'canned']],
    ['午餐肉', [], ['luncheon meat', 'spam']],
    ['急凍', ['冷凍'], ['frozen']],
    ['餃子', ['水餃'], ['dumpling', 'dumplings']],
    ['薯條', [], ['french fries', 'fries']],
    ['薄餅', [], ['pizza']],

    // 家居・清潔
    ['廁紙', ['衛生紙', '卷紙'], ['toilet paper', 'toilet roll', 'tissue roll']],
    ['紙巾', ['抽紙', '面紙'], ['tissue', 'facial tissue', 'napkin']],
    ['廚房紙', [], ['kitchen towel', 'paper towel']],
    ['洗潔精', ['洗碗液'], ['dishwashing liquid', 'dish soap']],
    ['洗衣液', ['洗衣粉'], ['laundry detergent', 'detergent']],
    ['柔順劑', ['衣物柔順劑'], ['fabric softener']],
    ['漂白水', [], ['bleach']],
    ['清潔劑', [], ['cleaner', 'cleaning']],
    ['垃圾袋', [], ['garbage bag', 'trash bag', 'rubbish bag']],
    ['保鮮紙', ['錫紙'], ['cling wrap', 'plastic wrap', 'foil', 'aluminium foil']],
    ['蚊怕水', ['驅蚊'], ['mosquito repellent']],
    ['除臭劑', ['芳香劑'], ['air freshener', 'deodoriser']],
    ['電池', [], ['battery', 'batteries']],

    // 個人護理
    ['洗頭水', ['洗髮水', '洗髮乳', '洗髮露'], ['shampoo']],
    ['護髮素', [], ['conditioner']],
    ['沐浴露', ['沖涼液'], ['body wash', 'shower gel']],
    ['番梘', ['肥皂'], ['soap']],
    ['牙膏', [], ['toothpaste']],
    ['牙刷', [], ['toothbrush']],
    ['漱口水', [], ['mouthwash']],
    ['洗面奶', ['潔面'], ['facial cleanser', 'face wash']],
    ['面霜', ['保濕'], ['moisturiser', 'moisturizer', 'face cream']],
    ['面膜', [], ['face mask', 'sheet mask']],
    ['防曬', [], ['sunscreen', 'sunblock', 'spf']],
    ['爽膚水', [], ['toner']],
    ['精華', ['精華液'], ['serum', 'essence']],
    ['潤唇膏', [], ['lip balm']],
    ['護手霜', [], ['hand cream']],
    ['潤膚露', ['身體乳'], ['body lotion', 'lotion']],
    ['止汗劑', [], ['deodorant', 'antiperspirant']],
    ['剃鬚', [], ['razor', 'shaving']],
    ['衛生巾', ['衛生棉'], ['sanitary pad', 'sanitary napkin', 'pads']],
    ['棉條', [], ['tampon', 'tampons']],
    ['濕紙巾', [], ['wet wipes', 'wipes']],
    ['棉花棒', ['棉棒'], ['cotton bud', 'cotton swab', 'q-tip']],
    ['化妝棉', [], ['cotton pad']],
    ['口罩', [], ['mask', 'face mask', 'surgical mask']],
    ['消毒搓手液', ['消毒'], ['hand sanitiser', 'hand sanitizer', 'sanitiser']],

    // 藥物・保健
    ['維他命', ['維生素'], ['vitamin', 'vitamins']],
    ['止痛藥', [], ['painkiller', 'panadol', 'paracetamol']],
    ['膠布', ['創可貼'], ['plaster', 'band aid', 'bandage']],
    ['益生菌', [], ['probiotic', 'probiotics']],
    ['膠原蛋白', [], ['collagen']],

    // 母嬰・寵物
    ['尿片', ['紙尿褲'], ['diaper', 'diapers', 'nappy']],
    ['奶粉', [], ['formula', 'milk powder']],
    ['嬰兒', [], ['baby', 'infant']],
    ['貓糧', ['貓'], ['cat food', 'cat']],
    ['狗糧', ['狗'], ['dog food', 'dog']],
    ['貓砂', [], ['cat litter']],
  ];

  // 建雙向索引：任何詞 → 一組同義詞（含中英）
  const INDEX = new Map();
  for (const [zh, zhAlt, en] of RAW) {
    const group = [zh, ...zhAlt, ...en];
    for (const term of group) {
      const k = term.toLowerCase();
      if (!INDEX.has(k)) INDEX.set(k, new Set());
      for (const g of group) INDEX.get(k).add(g);
    }
  }

  const CJK = /[一-鿿]/;
  const hasCJK = (s) => CJK.test(s);

  /**
   * 一個詞嘅所有同義詞。
   * 單個中文字（「奶」「蛋」）會夾中一大堆唔關事嘅嘢 ——「奶瓶刷」「蛋卷」——
   * 所以除非使用者本身就係打嗰個字，否則唔攞佢嚟比對。
   */
  function synonyms(q) {
    const rawQ = String(q || '').trim();
    const g = INDEX.get(rawQ.toLowerCase());
    if (!g) return rawQ ? [rawQ] : [];
    const tooShort = (t) => hasCJK(t) && t.length === 1 && t !== rawQ;
    const out = [...g].filter((t) => !tooShort(t));
    return out.length ? out : [rawQ];
  }

  /**
   * 把使用者輸入展開成要向超市搵嘅字詞（每個 = 一次上游請求，唔好太多）。
   * 'milk' → ['milk', '牛奶']；'廁紙' → ['廁紙', 'toilet paper']
   */
  function expandQuery(q, max) {
    const limit = max || 2;
    const rawQ = String(q || '').trim();
    if (!rawQ) return [];
    const group = INDEX.get(rawQ.toLowerCase());
    const out = [rawQ];
    if (group) {
      const others = [...group].filter((t) => t.toLowerCase() !== rawQ.toLowerCase());
      const zh = others.filter(hasCJK);
      const en = others.filter((t) => !hasCJK(t));
      // 打英文 → 中文行先（超市商品名多數中文）；打中文 → 補返英文
      const pref = hasCJK(rawQ) ? en.concat(zh) : zh.concat(en);
      for (const t of pref) if (out.indexOf(t) < 0) out.push(t);
    }
    return out.slice(0, limit);
  }

  /* ---------- 正規化同評分 ---------- */

  const PUNCT = /[()（）[\]【】,，.。/\\|、'"“”`~!@#$%^&*_+=?<>:;-]/g;
  const FULLWIDTH = /[！-～]/g;

  /** 全形轉半形、去標點、英文細楷 */
  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .replace(FULLWIDTH, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(PUNCT, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const BRACKETS = /[（(【[][^）)】\]]*[）)】\]]/g;
  /* 收尾唔可以用 \b —— 中文字唔算 word character，所以「500克」「10卷」用 \b 係完全剝唔走。
     改用「後面唔係英數」嘅前瞻，中英文都啱。 */
  const SIZE_TAIL = /\d+(?:\.\d+)?\s*(?:kgs?|gms?|gr|g|mls?|ltrs?|lts?|lt|l|pcs?|pkt?s?|ea|公斤|公升|毫升|克|片|包|件|入|支|條|盒|卷|裝)(?![A-Za-z0-9])/gi;

  /** 去掉尾巴嘅規格同括號備註，睇返個「淨名」 —— 用嚟判斷中心詞 */
  function headName(s) {
    return String(s || '')
      .replace(BRACKETS, ' ')
      .replace(SIZE_TAIL, ' ')
      .replace(/[\d.\s]+$/, '')
      .trim();
  }

  /* 寵物分類：百佳 08 開頭，惠康「貓貓專區 / 狗狗專區」。
   *
   * 寵物糧個名尾好興叫「三文魚」「雞胸」，搵買餸嘢嗰陣佢哋會霸晒頭位。
   * 但用家真係有貓有狗，所以**唔可以收埋佢哋** —— 只係輕輕壓低，
   * 令真正嘅餸菜行先；一搵寵物字眼（或者開咗 includePets）就即刻唔扣分。
   */
  const PET_CAT = /^08/;
  const PET_CAT_WC = new Set(['189651', '189941']);
  const PET_WORD = /貓|狗|寵物|毛孩|cat\b|dog\b|pet\b|kitten|puppy/i;
  const PET_DEMOTE = 45;

  const isPetCat = (catId) => {
    const c = String(catId || '');
    return !!c && (PET_CAT.test(c) || PET_CAT_WC.has(c));
  };

  /** 呢個搜尋本身係咪搵緊寵物嘢 */
  function isPetQuery(terms, qn) {
    if (qn && PET_WORD.test(qn)) return true;
    return (terms || []).some((t) => PET_WORD.test(t));
  }

  /**
   * 一件貨對一組字詞有幾夾。三個重點：
   *  1. 中心詞係咪喺個名尾（「全脂牛奶」係奶、「牛奶朱古力」係朱古力）
   *  2. 命中詞佔個名幾多（避免「雞蛋」夾到「雞蛋饅頭」）
   *  3. 分類有冇對得上（「蛋類」就真係蛋）
   * 另外：唔係搵寵物嘢就大幅扣寵物糧嘅分。
   *
   * headSrc = 用嚟判斷中心詞嗰個字串。**一定要淨係商品名**，
   * 唔可以連品牌一齊擺 —— 「全脂牛奶 屈臣氏」尾巴變咗品牌，中心詞就認唔到。
   * 唔傳就當同 nameNorm 一樣。
   * opts 可以係 catId 字串，或者 {catId, includePets}；includePets = true 就完全唔扣寵物分。
   */
  function scoreItem(nameNorm, catNorm, terms, qn, headSrc, opts) {
    const o = typeof opts === 'string' || opts == null ? { catId: opts } : opts;
    // o.head = 預先算好嘅「淨名」。唔傳就即場算 —— 但掃成萬件貨嗰陣行正則好貴，
    // 所以索引嗰邊會預先算定，慳成倍時間。
    const head = o.head != null ? o.head : headName(headSrc == null ? nameNorm : headSrc);
    let best = 0;
    for (const t of terms) {
      if (!t) continue;
      const i = nameNorm.indexOf(t);
      // 分類要整個詞夾中先算數；用單字會鬆到「洗頭水」夾中「水果」
      const inCat = catNorm ? catNorm.indexOf(t) >= 0 : false;
      if (i < 0 && !inCat) continue;
      let sc = 0;
      if (i >= 0) {
        sc += 45;
        if (head.length >= t.length && head.slice(-t.length) === t) sc += 40;
        sc += Math.round((t.length / Math.max(t.length, nameNorm.length)) * 25);
        if (t === qn) sc += 10;
        if (head === t) sc += 25;
      }
      if (inCat) sc += i >= 0 ? 28 : 20;
      if (sc > best) best = sc;
    }
    // 佢會買新鮮雞胸／三文魚返去煮俾貓狗食，所以新鮮食材要行先；
    // 但寵物貨唔會消失，只係排喺後面少少，隨時撳一下就睇返晒。
    if (best && !o.includePets && isPetCat(o.catId) && !isPetQuery(terms, qn)) {
      best = Math.max(1, best - PET_DEMOTE);
    }
    return best;
  }

  /** 常見搜尋詞（前端快速按鈕用） */
  const POPULAR = [
    '牛奶', '雞蛋', '麵包', '廁紙', '紙巾', '洗頭水', '米', '雞胸',
    '三文魚', '蕃茄', '香蕉', '雪糕', '薯片', '可樂', '洗衣液', '洗潔精',
  ];

  return { RAW, synonyms, expandQuery, norm, headName, scoreItem, hasCJK, POPULAR, isPetCat, isPetQuery };
}));
