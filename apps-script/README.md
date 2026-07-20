# Google Apps Script 後端

這個資料夾是 GitHub Pages 練習平台的 Google Apps Script Web App 後端。

## 綁定資料表

1. 從學校帳號擁有的 Google Sheet「日語配音練習平台_後台資料」開啟「擴充功能 → Apps Script」。
2. 將 `Code.gs` 與 `appsscript.json` 放入專案。
3. 回到資料表重新整理，從「配音練習平台」選單執行「初始化平台」。
4. 記下只顯示一次的 8 位數老師密碼。
5. 部署為 Web App：執行身分選「我」，存取權選「任何人」。
6. 把部署後 `/exec` 網址填入網站 `config.js`。

學生 PIN 原文只出現在私人資料表的 `PIN發放單` 與老師重設結果；`Students` 工作表只保存加鹽 SHA-256 雜湊。

每次逐句送出會更新 `Results` 的最新成績，並把每一次評分、錄音秒數與時間寫入 `AttemptHistory`。錄音寫到設定的學校 Drive 資料夾；相同學生、作業與句次只保留最後一次錄音檔。

老師在 `Students` 工作表或網站後台設定組別。學生只能選擇作品與角色；熟練度以該角色每一句的最新成績總和除以角色總句數計算，尚未練習的句子以 0 分計。
