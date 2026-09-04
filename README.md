# 🧺 買餸小幫手 · 惠康 × 百佳比價

一個**只喺你部電腦度運行**嘅小網站，用嚟即時查惠康同百佳網上超市嘅價錢、重量、單價同有冇貨。
唔會自動上傳去任何地方、冇 GitLab、冇雲端、冇帳號。

> 想畀香港嘅朋友喺佢自己部 iPad 開？可以**你自己撳掣**放上 GitHub Pages ——
> 睇下面**第七節**。唔做嘅話呢個工具照舊淨係喺你部機行。

---

## 一、點開機

1. 電腦要有 [Node.js](https://nodejs.org)（隨便一個 LTS 版都得）。
2. 雙擊 **`開機.bat`** —— 會彈個黑色視窗，寫住開咗機。
   **唔好熄咗嗰個視窗**，佢就係個 server。
3. 雙擊 **`開網頁.bat`**，或者自己開 <http://localhost:8787>。

熄機：喺黑色視窗撳 `Ctrl + C`，或者直接叉咗佢。

---

## 二、iPad / iPhone 點用

開機嗰陣個視窗會印一條咁嘅網址：

```
同一 Wi-Fi：http://192.168.x.x:8787   ← iPad 用呢條
```

**要求：iPad 同部電腦要駁緊同一個 Wi-Fi，而部電腦要開住機。**

喺 iPad Safari 打嗰條網址 → 撳分享鍵 → **加入主畫面**。
之後主畫面就有個粉紅色籃仔圖示，撳一下好似 app 咁全螢幕開，唔會見到 Safari 個網址列。

> 如果打唔開：多數係 Windows 防火牆擋咗。第一次開機時彈出嘅視窗要揀「允許存取」；
> 或者去「Windows Defender 防火牆 → 允許應用程式」，勾返 Node.js 嘅「私人網路」。

---

## 三、有咩功能

| 功能 | 講解 |
|---|---|
| **中英文搜尋** | 打 `milk` 會搵到「牛奶」，打「廁紙」會搵到 toilet paper。內置約 200 組雜貨中英對照詞。 |
| **排序同篩選** | 最相關 / 價錢最平 / 單價最抵 / 折扣最勁；可以淨係睇一間、只睇有貨、只睇特價。撳落去即刻變，唔使等。 |
| **分類瀏覽** | 惠康 22 個大分類；百佳按大類 → 中類 → 細類逐層揀。落到底撳「睇多啲」再攞下一版。 |
| **單價比較** | 由商品名／官方規格自動解析重量容量，換算成 **每 100 克 / 每 100 毫升 / 每件**。大包定細包抵，一眼睇得出。 |
| **有冇貨** | 惠康撳入商品先查得到（要開商品頁）；百佳喺列表已經有。 |
| **特價同促銷** | 原價劃線、折扣 %、「3件$45」「買一送一」等標籤。 |
| **價格記錄** | 每次見到個價都會記低喺你部機。同一件嘢平咗會出「最低價」章，商品頁仲有走勢圖。 |
| **購物清單** | 撳 `＋` 一下就入清單，唔使打字。有數量加減、每間超市小計、總數。 |
| **行超市可以剔走** | 每行左邊有個格仔，買咗就撳一下，會變灰兼劃走，仲會計返「仲有幾多件未買」。 |
| **貼一段字入清單** | WhatsApp 收到嘅清單成段貼落去（分行、逗號、頓號都得），佢會逐樣幫你搵，再一撳全部加入。 |
| **常用清單** | 「每星期例牌」嗰批儲低，下次一撳全部加返。 |
| **收藏常買** | 撳個 ♡，之後喺「常買」一頁一撳「全部加入清單」。 |
| **成張清單格價** | 撳「🔍 幫我格價」，兩間超市各自埋單幾多、邊間平、逐件邊間抵，全部列出嚟。 |
| **離線都開到** | 加咗主畫面之後，介面同商品圖會存喺 iPad。**價錢一定行網絡**（唔會出舊價）。就算電腦熄咗機、去到超市冇 Wi-Fi，**張清單同常買一樣開得到、tick 得到** —— 佢哋係存喺 iPad 度。 |
| **睇得到資料幾時攞** | 最底一行會寫住百佳目錄幾多件、幾時更新過，仲有粒掣可以即刻叫佢更新。 |

---

## 四、資料由邊度嚟、點解要咁做

| 超市 | 攞資料嘅方法 | 點解 |
|---|---|---|
| **惠康** wellcome.com.hk | 即時。搜尋同分類直接讀佢個網頁（頁面本身已經render好資料）。 | 佢個 `robots.txt` 冇擋搜尋同分類頁。 |
| **百佳** parknshop.com | 分類即時攞；**搜尋行本地索引**。 | 百佳個 `robots.txt` 寫明 `Disallow: /search?`，所以呢個工具**唔會**去打佢個搜尋頁。改為由佢自己公佈嘅 sitemap 攞分類，行容許嘅分類頁砌一份本地目錄，搜尋喺你部機度做。 |

另外做咗幾樣「乖客仔」嘅嘢：

* 每個網站兩次請求之間有間隔（惠康 0.9 秒、百佳 1.5 秒），唔會連珠炮發。
* 搜尋同分類結果快取 30 分鐘、商品詳情 6 小時、商品圖 7 日，存喺 `data/cache/`。
* 惠康攞商品圖時只讀網頁開頭 24KB 就收線（張圖嘅網址喺 `<head>` 度），慳好多流量。

### 百佳索引

* 位置：`data/pns-index.json`
* 行 225 個細分類、每個最多 8 版（行到冇新貨就自己收），大概 **30–45 分鐘**，喺背景做，唔阻你用。
* 百佳全個目錄大約 25,800 件；索引攞嘅係每個分類頭幾版，日常買開嗰啲基本上齊。
* 超過 24 鐘頭會喺開機時自動更新一次。
* 想即刻更新：介面上有「而家更新」掣，或者行 `node rebuild-index.js`。
* 索引只影響**百佳嘅搜尋**。百佳嘅分類瀏覽同惠康全部都係即時攞，永遠係最新價。
* 搵唔到某件百佳貨？行「分類」入去嗰個細分類慢慢揀，嗰邊係即時攞，一定齊。

---

## 五、檔案

```
hk-price-buddy/
├── 開機.bat / 開網頁.bat      雙擊就用
├── server.js                  本機 server（唔使裝任何套件）
├── lib-stores.js              惠康 / 百佳 抓取同正規化
├── lib-units.js               規格解析 + 單價換算
├── lib-dict.js                中英對照詞庫
├── lib-index.js               百佳本地索引
├── lib-cache.js               快取 + 節流
├── gen-icons.js               整 app 圖示（改咗圖先要行）
├── build-snapshot.js          砌 GitHub Pages 版嘅價錢快照
├── 發佈到GitHub.md            照住抄就放到上網（第七節嘅簡短版）
├── .gitignore                 邊啲檔唔好上 GitHub
├── .github/workflows/
│   ├── refresh.yml            每 6 個鐘自動重抓價錢
│   └── pages.yml              把 public/ 派上 GitHub Pages
├── public/                    網頁本體（HTML / CSS / JS / PWA）
│   └── data/                  價錢快照（GitHub 版靠佢出價，**要**上 GitHub）
└── data/                      你部機自己嘅嘢，**唔好**上 GitHub
    ├── cache/                 網頁快取，隨時可以刪
    ├── pns-index.json         百佳本地目錄
    └── history.json           價格記錄
```

清單、收藏、常用清單係存喺 **iPad 個瀏覽器**度（localStorage），唔會經過電腦。
價格記錄就存喺電腦嘅 `data/history.json`。

---

## 六、有咩要留意

* **價錢係網上超市價。** 門市價有機會唔同 —— 呢個工具係俾你去到超市之前心裡有個底，唔係保證。每件貨都有「去官網睇 ↗」可以核對。
* **兩間嘅貨唔一定一模一樣。** 「幫我格價」係用名同規格夾出嚟嘅最接近嗰件，當參考好過當定案 —— 每行都有寫低夾到邊件貨。夾唔夠似佢會寧願話「搵唔到」，唔會亂咁配對。
* **「最相關」嘅排法**：惠康嗰批照佢自己個搜尋次序排（佢排得幾準），百佳嗰批按夾中程度排喺後面。想專心睇一間就撳上面「惠康 / 百佳」，或者轉做「價錢最平」「單價最抵」，兩間就會撈埋一齊比。
* 超市改版就有機會抓唔到嘢。抓法集中喺 `lib-stores.js`，出事多數改嗰度就搞掂。
* 呢個係**私人用嘅小工具**，唔好攞去做商業用途或者大量抓取。

---

## 七、放上 GitHub 俾朋友用

> ### ✅ 呢啲已經做好咗
> repo 已經開好、code 已經 push 上 <https://github.com/a96020183/moon-supermarket>。
> **剩返一步要你自己撳**（GitHub 唔准機械人改帳戶設定）：
> 去 <https://github.com/a96020183/moon-supermarket/settings/pages>，
> **Source** 揀 `GitHub Actions` → 跟住 Actions 頁面 Run 一次「派上 GitHub Pages」。
> 詳細兩分鐘版本 → 開 **`發佈到GitHub.md`**。
>
> 下面 7.3 ～ 7.5 係留返做參考（將來想搬 repo、或者想自己由頭做一次先用得着）。

> 呢一節當你**完全唔識 git**。逐句抄就得。
> 想要張純指令嘅單，唔想睇解釋 → 開 **`發佈到GitHub.md`**。

### 7.0 點解要搞呢一大輪？

第二節嗰條 `http://192.168.x.x:8787` 係**你屋企個路由器裡面**嘅門牌號碼。
香港嗰位朋友喺佢自己屋企打同一條網址，佢部機會去搵**佢屋企**嘅 192.168.x.x ——
即係佢部打印機或者佢部電視，梗係開唔到。呢個唔係你設定錯，全世界都係咁。

要佢開到，就要有條**真係喺互聯網上面**嘅網址。
GitHub Pages 就係一個免費、唔使自己養 server 嘅做法：你把 `public/` 擺上 GitHub，
佢幫你出一條 `https://a96020183.github.io/moon-supermarket/`，全世界（包括香港部 iPad）都開得到。

但 GitHub Pages **淨係派靜態檔**，佢唔會幫你行 `server.js`，即係冇人幫你即時去抓價。
所以要有一份**價錢快照**：定時抓一次價，寫成三份 JSON 擺喺 `public/data/`，個網頁讀嗰三份 JSON。

**`.github/workflows/refresh.yml` 做嘅就係呢件事：每 6 個鐘 GitHub 自己開部機、抓一次價、
更新 `public/data/`、再自動重新派一次 Pages。你部電腦熄咗機都照行。**

### 7.1 兩個版本有咩分別（要同朋友講清楚）

| | 本機版（`開機.bat`） | GitHub 版（Pages） |
|---|---|---|
| 網址 | `http://192.168.x.x:8787` | `https://a96020183.github.io/moon-supermarket/` |
| 邊個開到 | 淨係同一個 Wi-Fi 嘅人 | 全世界 |
| 你部電腦要唔要開住 | **要** | 唔使 |
| 價錢幾新 | **即時** —— 撳落去嗰刻先去問超市 | **最多舊 6 個鐘** |
| 有貨冇貨 | 惠康撳入去即時查 | 抓快照嗰刻嘅狀態，可能過咗時 |
| 分類瀏覽 | 全部分類、全部貨 | 快照攞到嗰啲 |
| 購物清單 / 常買 / 剔走 | ✅ | ✅（存喺佢部 iPad，同你嗰部各有各嘅） |
| 價格走勢圖 | ✅（存喺你部機） | ❌（價格記錄唔會上 GitHub） |

一句講晒：**你自己買餸用本機版（最準），朋友用 GitHub 版（開到就得）。**
GitHub 版最底一行會寫住「快照幾時抓」，唔會扮即時。

### 7.2 ⚠️ 落手之前：Pages 係公開嘅

免費戶口嘅 GitHub Pages **一定係公開**。即係話：

* 條網址任何人知道就開到，唔使登入。
* `public/data/` 入面係惠康百佳嘅商品名同價錢 —— 呢啲本身係兩間超市自己擺喺網上嘅嘢，唔係你嘅私隱。
* 但個 repo 入面仲有你份 code、README、同埋 commit 記錄（幾時更新過都睇得到）。
* **你嘅購物清單、常買、價格記錄唔會上去** —— 清單存喺 iPad，`data/history.json` 畀 `.gitignore` 擋咗。

想私隱啲有兩條路：

1. **私人 repo 出 Pages** —— 要 **GitHub Pro**（大約 US$4 一個月）先做得到。
   出嚟條網址一樣係公開嘅，但個 repo（你份 code）唔會畀人睇到。
2. **唔用 Pages** —— 繼續淨係本機版，朋友嚟你屋企先用。

自己揀。覺得「不過係超市價錢啫」，用免費公開 repo 完全冇問題。

### 7.3 第一步：喺 GitHub 開個 repo

未有戶口就去 <https://github.com/signup> 開一個，免費。

**做法 A · 用網頁（唔識打指令就揀呢個）**

1. 開 <https://github.com/new>
2. **Repository name** 打 `moon-supermarket`
3. 揀 **Public**（有 Pro 就可以揀 Private）
4. 下面 **三個都唔好剔** —— "Add a README file"、"Add .gitignore"、"Choose a license" 全部留空。
   （我哋本機已經有 README 同 .gitignore，剔咗會撞。）
5. 撳 **Create repository**
6. 佢會出一版嘢，入面有條 `https://github.com/a96020183/moon-supermarket.git` —— **抄低佢**，下一步要用。

**做法 B · 用 GitHub CLI（識打指令就快好多）**

裝咗 <https://cli.github.com> 之後：

```powershell
gh auth login          # 第一次要登入，跟住佢問乜就揀乜
gh repo create moon-supermarket --public --source . --remote origin
```

呢句順手幫你開埋 repo 兼駁好 `origin`，7.4 嗰句 `git remote add` 就唔使打。

### 7.4 第二步：喺你部機 push 上去

開 **PowerShell**（撳開始掣打 "powershell"），逐句抄。`#` 後面嗰啲係解釋，唔使打。

```powershell
cd C:\Users\user1\hk-price-buddy

node build-snapshot.js       # ① 先砌一份快照，唔係 Pages 會白晒

git init                     # ② 話畀 git 知呢個資料夾開始要記錄
git branch -M main           # ③ 條主線叫 main（GitHub 用呢個名）
git add .                    # ④ 揀晒啲檔（.gitignore 擋咗嘅自動唔會入）
git status                   # ⑤ 停一停，睇清楚（下面有講睇乜）

git commit -m "第一版：買餸小幫手"
git remote add origin https://github.com/a96020183/moon-supermarket.git   # ⑥ 改做你自己嗰條
git push -u origin main      # ⑦ 推上去
```

**第 ⑤ 步一定要停低睇真：**

* 應該見到 `README.md`、`server.js`、`public/…`、**`public/data/meta.json`** 呢啲。
* **唔應該**見到 `data/pns-index.json`、`data/cache/…`、`data/history.json`、`_` 開頭嗰堆。
* 見到唔應該有嘅 → 唔好 commit，返去睇 `.gitignore` 係咪打錯咗字。

**第一次 `git commit` 可能會鬧你「唔知你係邊個」**，照佢講打呢兩句（一世淨係做一次）：

```powershell
git config --global user.name  "你個名"
git config --global user.email "你個 email"
```

**`git push` 會叫你登入。** 多數會彈個瀏覽器窗畀你撳 **Authorize**。
如果佢喺黑窗度問你 password —— **唔好打你 GitHub 密碼**（打咗都唔會過），佢要嘅係 Personal Access Token：
GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) →
Generate new token → 剔 **`repo`** → 抄低嗰串字，當密碼咁貼落去。

### 7.5 第三步：開 Pages

1. 上你個 repo（`https://github.com/a96020183/moon-supermarket`）
2. 上面撳 **Settings**（齒輪）
3. 左邊揀 **Pages**
4. **Build and deployment → Source** 揀 **GitHub Actions**
   **唔好**揀 "Deploy from a branch" —— 我哋兩個 workflow 都係照 GitHub Actions 呢個做法寫。
   （點解？branch 做法要成日開多條 `gh-pages` branch 嚟擺同一份嘢，個 repo 會多咗一堆重複檔案，
   而且抓完價要自己再 copy 過去；官方呢個做法係打包完直接派，冇呢啲手尾。）
5. 撳 **Save**（有啲版面揀完自動存，冇 Save 掣）

跟住撳返上面 **Actions**：

* 應該見到「派上 GitHub Pages」行緊，等佢由黃色轉綠色 ✅（一兩分鐘）
* 綠咗返去 Settings → Pages，最上面會出條網址：`https://a96020183.github.io/moon-supermarket/`
* 撳落去試下。開到就成功。

**佢冇自己行？** Actions → 左邊揀「派上 GitHub Pages」→ 右邊 **Run workflow** → 撳綠掣。

### 7.6 第四步：試下定時更新

唔使等足 6 個鐘先知行唔行得：

1. Actions → 左邊揀 **「更新價錢快照」**
2. 右邊 **Run workflow** → 再撳綠色 **Run workflow**
3. 撳入去睇佢行。行完會有個摘要，寫住抓咗幾多件貨。

之後佢自己每 6 個鐘行一次（香港時間大約 **02:00 / 08:00 / 14:00 / 20:00**）。
價錢冇變嘅話佢就乜都唔做，唔會亂咁 commit。

> **⚠️ GitHub 有個怪規矩：個 repo 連續 60 日冇人 push 過嘢，佢會自動熄咗排程。**
> 熄咗嘅話 Actions 頁最上會有句黃色字同埋一粒 **Enable workflow** 掣，撳一下就返生。
> 兩個月上去撳一撳就得。

### 7.7 第五步：叫朋友加入主畫面

WhatsApp 條 `https://a96020183.github.io/moon-supermarket/` 畀佢，叫佢：

> Safari 開條網址 → 撳下面中間個**分享**鍵（正方形向上箭嘴）→ 碌落去揀**加入主畫面** → 撳加入

之後佢主畫面就有個粉紅籃仔，撳落去似 app 咁全螢幕開。

### 7.8 之後改咗嘢想更新

```powershell
cd C:\Users\user1\hk-price-buddy
git add .
git commit -m "改咗啲乜"
git push
```

推完 GitHub 自己重新派一次 Pages（一兩分鐘）。
**價錢唔使你理**，`refresh.yml` 每 6 個鐘自己搞掂。

### 7.9 唔好放上去嘅嘢

`.gitignore` 已經幫你擋晒，不過都講清楚點解：

| 檔 | 點解唔上 |
|---|---|
| `data/pns-index.json` | 成 **9 MB**，GitHub 會嫌肥；而且行 `node rebuild-index.js` 隨時砌得返。 |
| `data/cache/` | 抓落嚟嘅網頁快取，一大堆碎檔，刪咗都冇損失。 |
| `data/history.json` | 你部機自己嘅價格記錄，關你自己事，唔使畀人睇。 |
| `_` 開頭嗰啲（`_t30.js`、`_baseline.json`、`_shot/`…） | 整嘢時試嚟試去嘅臨時檔。 |
| `node_modules/` | 呢個 project 根本零套件，擺住做保險。 |

**唯獨 `public/data/` 一定要上。** 佢就係 GitHub 版嘅價錢本身，冇咗佢個網頁會出「載入失敗」。
`.gitignore` 最尾特登留咗兩行寫住呢件事，唔好手快剷咗。

> 已經唔小心 push 咗大檔上去？打 `git rm -r --cached data` 再 commit + push，
> 就會喺 GitHub 嗰邊剷走（你部機嗰份唔會冇咗）。

### 7.10 撞板急救

| 症狀 | 點搞 |
|---|---|
| 網址開到但白晒 / 出「載入失敗」 | 多數係 `public/data/` 冇 push 到。上 GitHub 撳入 `public/data` 睇下有冇三份 JSON。冇 → `node build-snapshot.js`，然後 `git add public/data`、`git commit -m "加快照"`、`git push`。 |
| Actions 出紅色 ❌ | 撳入去睇邊一步紅。紅喺「抓價錢、砌快照」＝超市改咗版或者擋咗，你部機行都會一樣，睇返第六節。 |
| `Get Pages site failed` / `Pages not enabled` | 7.5 嗰步未做，或者 Source 揀錯咗 "Deploy from a branch"。 |
| 排程唔自己行 | 睇 7.6 個 60 日規矩。另外 GitHub 繁忙時遲十幾廿分鐘係好常見，唔係壞咗。 |
| `git push` 話 `rejected` | GitHub 嗰邊有你本機冇嘅嘢（多數係機械人啱啱更新咗快照）。打 `git pull --rebase`，再 `git push`。 |
| 價錢好舊 | Actions → 更新價錢快照 → Run workflow，即刻更新。之後喺 iPad 落拉 refresh 一次。 |
| 朋友話個網址 404 | 大細楷要一模一樣，尾嗰個 `/` 唔好漏。條路徑係 `/hk-price-buddy/`（你個 repo 叫咩就係咩）。 |
