# 評分 API 契約

`POST` 至 `config.js` 的 `evaluationApiUrl`，內容為 `multipart/form-data`：

- `audio`: 學生錄音
- `work`: 作品名稱
- `role`: 角色名稱
- `target`: 標準日文台詞
- `start`, `end`: 示範台詞時間碼
- `recordingDuration`: 錄音秒數

回傳 JSON：

```json
{
  "overall": 86,
  "mode": "API 評分",
  "scores": {
    "台詞正確度": 92,
    "發音": 84,
    "節奏": 80,
    "表現": 83
  },
  "issues": ["長音「オー」略短", "句尾請再收乾淨"],
  "diffHtml": "僅含 diff-match、diff-extra、diff-missing span 的台詞比對 HTML"
}
```

API 金鑰只應放在後端環境變數中，不可寫進 `config.js` 或其他前端檔案。未設定 `evaluationApiUrl` 時，網站不會呼叫此 API。
