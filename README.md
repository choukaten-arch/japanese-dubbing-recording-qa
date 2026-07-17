# 日語配音錄音評分 QA

獨立於正式練習站的錄音評分流程測試版。QA 網站不會修改正式站，也不會把錄音檔儲存在網站伺服器。

目前未設定後端 API 時，使用瀏覽器日語語音辨識、台詞文字差異、錄音長度與音量產生測試分數，不產生 OpenAI API 費用。瀏覽器的語音辨識服務可能由瀏覽器供應商處理音訊；`config.js` 的 `evaluationApiUrl` 設定後，才會改將錄音檔送往自訂後端 API。

## 本機預覽

```bash
node scripts/serve.mjs
```

預設網址為 `http://127.0.0.1:4273/`。可用 `PORT=4300 node scripts/serve.mjs` 更改連接埠。

## 自動化測試

```bash
node scripts/test-qa.mjs
```
