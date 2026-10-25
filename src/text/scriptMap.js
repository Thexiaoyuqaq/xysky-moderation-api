/**
 * Traditional -> Simplified character folding.
 *
 * The dictionary is authored in Simplified Chinese, so the matcher folds
 * Traditional input instead of asking every entry to list Traditional aliases.
 * The table covers the characters used by the dictionary plus common chat
 * vocabulary; it is not a complete OpenCC replacement.
 *
 * Each token must be exactly two code points: `traditional` + `simplified`.
 */
const PAIRS = `
們们 個个 這这 麼么 嗎吗 說说 話话 誰谁 對对 錯错 沒没 會会 來来
覺觉 愛爱 歡欢 開开 關关 聽听 見见 給给 讓让 時时 間间 現现 為为
還还 較较 從从 與与 並并 卻却 遊游 戲戏 務务 帳账 號号 網网 絡络
斷断 線线 連连 誤误 問问 題题 幫帮 謝谢 難难 過过 氣气 樂乐 醜丑
麗丽 討讨 厭厌 噁恶 變变 態态 經经 瘋疯 該该 獸兽 豬猪 貓猫 雞鸡
鴨鸭 鳥鸟 蟲虫 龍龙 鳳凤 龜龟 魚鱼 蝦虾 錢钱 買买 賣卖 價价 貴贵
費费 禮礼 蠟蜡 燭烛 圖图 節节 動动 載载 裝装 註注 冊册 碼码 郵邮
機机 電电 頻频 聲声 組组 讚赞 廣广 傳传 詐诈 騙骗 舉举 報报 鎖锁
檢检 員员 腳脚 擊击 禦御 馬马 資资 數数 據据 隱隐 證证 銀银 寶宝
轉转 賬账 匯汇 貸贷 賺赚 虧亏 門门 鏈链 點点 掃扫 維维 優优 腦脑
癱瘫 廢废 殘残 東东 兒儿 媽妈 滾滚 貨货 騷骚 賤贱 雜杂 種种 髒脏 殺杀
頭头 獻献 彈弹 黃黄 澀涩 體体 車车 膠胶 導导 後后 內内 顏颜 雙双
強强 藥药 陰阴 莖茎 睪睾 賭赌 盤盘 單单 職职 結结 釣钓 盜盗 財财
穩稳 師师 購购 練练 擴扩 進进 掛挂 輔辅 脫脱 褲裤 庫库 戀恋 銅铜
誘诱 納纳 視视 燦灿 輪轮 獨独 國国 顛颠 牆墙 華华 鬥斗 壇坛 幣币
圓圆 緣缘 惡恶 盡尽 邊边 達达 運运 選选 辦办 響响 應应 實实 際际
標标 確确 認认 無无 統统 計计 檔档 覽览 權权 讀读 寫写 刪删 賽赛
製制 偽伪 損损 壞坏 復复 備备 輸输 協协 議议 驗验 戶户 編编 譯译
亂乱 鍵键 顯显 頁页 瀏浏 設设 項项 預预 銷销 聯联 繫系 違违 規规
處处 罰罚 審审 詞词 庫库 濾滤 換换 蔽蔽 攔拦 擋挡 恢恢 訴诉 臨临
測测 帶带 贏赢 輸输 債债 幣币 圓圆 緣缘 惡恶 盡尽 邊边 達达 運运
戲戏 務务 帳账 號号 網网 絡络 斷断 線线 連连 誤误 問问 題题 幫帮
謝谢 難难 過过 氣气 樂乐 醜丑 麗丽 討讨 厭厌 噁恶 變变 態态 經经
瘋疯 該该 獸兽 豬猪 貓猫 雞鸡 鴨鸭 鳥鸟 蟲虫 龍龙 鳳凤 龜龟 魚鱼
蝦虾 錢钱 買买 賣卖 價价 貴贵 費费 禮礼 蠟蜡 燭烛 圖图 節节 動动
載载 裝装 註注 冊册 碼码 郵邮 機机 電电 頻频 聲声 組组 讚赞 廣广
傳传 詐诈 騙骗 舉举 報报 鎖锁 檢检 員员 腳脚 擊击 禦御 馬马 資资
數数 據据 隱隐 證证 銀银 寶宝 轉转 賬账 匯汇 貸贷 賺赚 虧亏 門门
鏈链 點点 掃扫 維维 優优 腦脑 癱瘫 廢废 東东 兒儿 媽妈 滾滚 貨货
騷骚 賤贱 雜杂 種种 髒脏 殺杀 頭头 獻献 彈弹 黃黄 澀涩 體体 車车
膠胶 導导 後后 內内 顏颜 雙双 強强 藥药 陰阴 莖茎 睪睾 賭赌 盤盘
單单 職职 結结 釣钓 盜盗 財财 穩稳 師师 購购 練练 擴扩 進进 掛挂
輔辅 脫脱 褲裤 庫库 戀恋 銅铜 誘诱 納纳 視视 燦灿 輪轮 獨独 國国
顛颠 牆墙 華华 鬥斗 壇坛 幣币 圓圆 緣缘 惡恶 盡尽 邊边 達达 運运
選选 辦办 響响 應应 實实 際际 標标 確确 認认 無无 統统 計计 檔档
覽览 權权 讀读 寫写 刪删 賽赛 製制 偽伪 損损 壞坏 復复 備备 輸输
協协 議议 驗验 戶户 編编 譯译 亂乱 鍵键 顯显 頁页 瀏浏 設设 項项
預预 銷销 聯联 繫系 違违 規规 處处 罰罚 審审 詞词 庫库 濾滤 換换
蔽蔽 攔拦 擋挡 恢恢 訴诉 臨临 測测 帶带 贏赢 輸输 債债 擁拥 擇择
擇择 撥拨 擔担 據据 輛辆 輪轮 轉转 載载 辦办 這这 邊边 過过 還还
場场 屍尸 滅灭 槍枪 襲袭 隨随 燒烧 姦奸 擾扰 褻亵 煉炼 產产 黨党
學学 筆笔 綠绿 癡痴 瑪玛 臥卧 絕绝 養养 爛烂 蕩荡 婦妇 敗败 類类
絲丝 幾几 罵骂 樣样 驢驴 飛飞 沖冲 飆飙 裡里 裏里 擼撸 漢汉 籌筹
莊庄 閒闲 發发 薦荐 軟软 長长 複复 寶宝 續续 臺台 灣湾 著着
`;

const map = new Map();

for (const token of PAIRS.split(/\s+/)) {
  if (!token) continue;
  const chars = Array.from(token);
  if (chars.length !== 2) {
    throw new Error(`scriptMap: invalid pair ${JSON.stringify(token)} (expected 2 code points)`);
  }
  const [traditional, simplified] = chars;
  if (traditional !== simplified) map.set(traditional, simplified);
}

module.exports = { TRADITIONAL_TO_SIMPLIFIED: map };
