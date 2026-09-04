# 📤 放上 GitHub —— 你朋友喺香港就開得到

呢個 repo 已經 push 咗上 <https://github.com/a96020183/moon-supermarket>。
**剩返一步要你自己撳**（GitHub 唔畀機械人改設定）：開 Pages。

想知點解要咁做、有咩要留意（尤其係「Pages 係公開嘅」），睇 `README.md` 第七節。

---

## ⚡ 你而家要做嘅（大約 2 分鐘）

### 第 1 步 —— 開 Pages

去 <https://github.com/a96020183/moon-supermarket/settings/pages>

**Build and deployment → Source** 揀 **`GitHub Actions`**，撳 Save（如果有嗰粒掣）。

> ⚠️ **唔好**揀 `Deploy from a branch`。兩個 workflow 都係照 `GitHub Actions` 呢個做法寫。

### 第 2 步 —— 叫佢派一次

去 <https://github.com/a96020183/moon-supermarket/actions>

左邊揀 **「派上 GitHub Pages」** → 右邊 **Run workflow** → 撳綠色掣 → 等佢轉綠 ✅（一兩分鐘）。

> **見到紅色 ❌ 唔使驚**：第一次 push 嗰陣 Pages 未開，所以嗰次一定會喺 `configure-pages`
> 紅字話你 `Get Pages site failed`。做完第 1 步再 Run 一次就會綠。

### 第 3 步 —— 攞條網址傳俾朋友

綠咗之後返 Settings → Pages，會見到：

```
https://a96020183.github.io/moon-supermarket/
```

WhatsApp 傳條 link 俾佢 → 佢 iPad Safari 開 → **分享鍵 → 加入主畫面** → 搞掂。

---

## 之後會自己運作

| 幾時 | 做咩 |
|---|---|
| 每 6 個鐘 | 重抓**惠康**（主場）成 22 個分類嘅價，順手補 1,200 張商品圖 |
| 每日一次（香港凌晨 2 點） | 連**百佳** 225 個細分類都重爬一次 |
| 價錢真係有變先 | 至會 commit + 重新派 Pages（冇變就唔郁，唔會發水） |

想即刻更新唔使等：Actions → **「更新價錢快照」** → Run workflow。
（嗰度仲有兩個掣：`full` 打勾就連百佳一齊重爬、`images` 改一次補幾多張圖。）

> GitHub 規矩：repo 連續 60 日冇人郁過，排程會自動停。
> 停咗上去 Actions 撳一下「Enable workflow」就返生。

---

## 兩個版本點分

| | 本機版 | GitHub 版 |
|---|---|---|
| 點開 | 部電腦雙擊 `開機.bat` | 條 github.io 網址，邊度都開到 |
| 價錢 | **即時抓**，最準 | 每 6 個鐘更新一次嘅快照 |
| 要電腦開住機？ | 要 | **唔使** |
| 邊個用 | 你 | 你朋友 |

兩個版本係同一份 code、同一套搜尋邏輯（`public/search-core.js`），
所以打「milk」兩邊都會搵到「牛奶」，排序都一樣。

---

## 日常想手動更新就呢三句

```powershell
cd C:\Users\user1\hk-price-buddy
node build-snapshot.js            # 重抓價、砌快照
git add -A public/data ; git commit -m "更新價錢" ; git push
```

push 完 `pages.yml` 會自己重新派，唔使再撳嘢。

---

## 卡住嘅話

| 佢話 | 點算 |
|---|---|
| `Get Pages site failed` | Pages Source 未揀 `GitHub Actions`，返上面第 1 步 |
| 網頁白晒 / 載入失敗 | `public/data/` 冇 push 到 → 行上面「日常三句」 |
| `git push` 話 `rejected` | `git pull --rebase` 再 `git push` |
| 問你 password | 唔係 GitHub 密碼！要 Personal Access Token：Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token → 剔 `repo` |
| 排程唔郁 | Actions → 揀嗰個 workflow → 「Enable workflow」 |
| 想落架 | Settings → Pages → Source 揀返 `None`；或者 Settings → 最底 Delete this repository |

---

## ⚠️ 記住

- 條 `github.io` 網址係**公開**嘅，任何人有 link 都開到。入面得超市商品名同價錢
  （兩間超市自己個網站本來就公開），**冇**你或者朋友嘅任何個人資料。
  清單、常買、收藏全部存喺佢部 iPad 度，唔會上網。
- 想私隱啲就要 GitHub Pro（私人 repo 出 Pages）。
- 呢個係私人用嘅小工具，唔好攞去做商業用途。
