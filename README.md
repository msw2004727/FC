# ⚽ KICKOFF 足球報名系統

一個功能完整的線上足球運動報名系統，支援 LINE 登入、活動管理、積分排行榜等功能。

## 🌟 功能特色

### 用戶功能
- **LINE 登入**：一鍵登入，自動同步 LINE 頭像與暱稱
- **活動報名**：查看活動、報名參加、候補功能
- **個人中心**：查看與編輯個人資料
- **積分系統**：完成活動獲得積分，臨時取消扣除積分
- **排行榜**：週/雙週/月/季/年積分排行

### 管理員功能
- **活動管理**：建立、編輯、刪除活動
- **用戶管理**：查看用戶、修改權限
- **積分設定**：自訂積分公式
- **QR Code 報到**：生成報到 QR Code，支援掃碼/手動報到
- **數據統計**：性別、年齡、慣用腳、位置分佈圖表

### 其他功能
- 🌓 亮/暗主題切換
- 📱 響應式設計，支援手機/平板/電腦
- 🔗 社群分享（LINE、Facebook、Twitter）
- ⏰ 活動預約發布與自動關閉

## 📁 檔案結構

```
football-registration/
├── index.html      # 主頁面（HTML 結構）
├── styles.css      # 樣式檔案（CSS）
├── app.js          # 應用程式邏輯（JavaScript）
└── README.md       # 說明文件
```

## 🚀 快速開始

### 1. 設定 Firebase

1. 前往 [Firebase Console](https://console.firebase.google.com/)
2. 建立新專案
3. 啟用 Firestore Database 和 Storage
4. 取得設定資訊，填入 `app.js` 的 `CONFIG.firebase`：

```javascript
const CONFIG = {
    firebase: {
        apiKey: "你的_API_KEY",
        authDomain: "你的專案.firebaseapp.com",
        projectId: "你的專案ID",
        storageBucket: "你的專案.appspot.com",
        messagingSenderId: "你的SENDER_ID",
        appId: "你的APP_ID"
    },
    // ...
};
```

### 2. 設定 LINE Login

1. 前往 [LINE Developers Console](https://developers.line.biz/)
2. 建立 Provider 和 LINE Login Channel
3. 建立 LIFF App，設定 Endpoint URL
4. 取得 LIFF ID，填入 `app.js` 的 `CONFIG.liffId`：

```javascript
const CONFIG = {
    // ...
    liffId: "你的_LIFF_ID"
};
```

### 3. 部署到 GitHub Pages

1. 建立 GitHub Repository
2. 上傳所有檔案
3. 前往 Settings > Pages
4. Source 選擇 `main` branch
5. 等待部署完成

### 4. 更新 LINE LIFF 設定

部署完成後，將 GitHub Pages URL 填入 LIFF App 的 Endpoint URL。

## 📊 Firebase 資料結構

### users 集合
```javascript
{
    uid: "LINE_USER_ID",
    lineNickname: "暱稱",
    avatar: "頭像URL",
    role: "rookie|veteran|coach|admin",
    gender: "male|female|other",
    age: 25,
    contact: "聯繫方式",
    preferredFoot: "left|right|both",
    positions: ["CM", "CAM"],
    completedCount: 0,
    canceledCount: 0,
    registrationCount: 0,
    gloryTag: "榮耀標籤",
    points: 0,
    coins: 0,
    createdAt: "ISO日期"
}
```

### events 集合
```javascript
{
    id: "活動ID",
    name: "活動名稱",
    banner: "Banner圖片URL",
    date: "2025-01-01",
    time: "14:00",
    location: "地點",
    price: 200,
    capacity: 20,
    description: "活動描述",
    publishAt: "預約發布時間",
    closeAt: "自動關閉時間",
    isOpen: true,
    registrations: 0,
    waitlist: 0,
    createdAt: "ISO日期"
}
```

### registrations 集合
```javascript
{
    eventId: "活動ID",
    userId: "用戶ID",
    status: "registered|waitlist|canceled|completed",
    checkedIn: false,
    registeredAt: "ISO日期"
}
```

### settings 集合
```javascript
// pointsFormula 文件
{
    complete: 10,   // 完成活動獲得積分
    cancel: 5,      // 取消扣除積分
    onTime: 2,      // 準時報到額外積分
    min: 0          // 最低積分
}
```

## 🔧 自訂修改指南

### 修改主題顏色
在 `styles.css` 中修改 CSS 變數：

```css
:root {
    --accent-primary: #2d8a4e;    /* 主色調 */
    --accent-secondary: #45b369;  /* 次要色調 */
    --accent-gold: #d4a534;       /* 金色（排行榜） */
    --accent-danger: #d94545;     /* 危險色（刪除、額滿） */
}
```

### 新增用戶欄位
1. 在 `app.js` 的 `simulateDemoLogin()` 和 `handleLineProfile()` 中新增欄位
2. 在 `index.html` 的個人資料表單中新增輸入欄位
3. 在 `UI.updateProfilePage()` 中處理新欄位

### 新增頁面
1. 在 `index.html` 中新增 `<div class="page" id="page-新頁面">`
2. 在導航列新增連結
3. 在 `App.navigateTo()` 中處理新頁面初始化

## 🔮 未來擴充

系統已預留以下擴充空間：

- **成就系統**：解鎖成就、徽章顯示
- **足球幣**：虛擬貨幣、獎勵兌換
- **二手交易區**：裝備買賣
- **隊伍系統**：組隊、隊伍排名
- **比賽記錄**：進球、助攻統計

## 📄 授權

MIT License

## 🙋 支援

如有問題或建議，歡迎提出 Issue 或 Pull Request。
