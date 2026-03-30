/**
 * Phase 2: Per-User Inbox Migration Script
 *
 * 使用方式：
 *   node scripts/migrate-inbox.js [--dry-run]
 *
 * 需先設定環境變數：
 *   GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account.json
 *
 * 或直接在專案 functions/ 目錄下執行（使用 Firebase Admin 預設認證）。
 */

const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

// ── 初始化（使用 Firebase Admin default credentials 或 service account）──
const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (serviceAccountPath) {
  admin.initializeApp({ credential: admin.credential.cert(require(serviceAccountPath)) });
} else {
  // 使用 projectId 直接初始化（適用於有 Firebase CLI 登入但無 service account 的情況）
  admin.initializeApp({ projectId: 'fc-football-6c8dc' });
}
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const DRY_RUN = process.argv.includes('--dry-run');

async function migrate() {
  console.log(`\n=== Per-User Inbox Migration ${DRY_RUN ? '(DRY RUN)' : ''} ===\n`);

  // 1. 載入所有用戶（用於展開 targetTeamId / targetRoles / targetType:all）
  console.log('Loading users...');
  const usersSnap = await db.collection('users').get();
  const users = {};
  usersSnap.forEach(doc => { users[doc.id] = doc.data(); });
  console.log(`  ${Object.keys(users).length} users loaded`);

  // 2. 載入所有訊息
  console.log('Loading messages...');
  const msgsSnap = await db.collection('messages').get();
  const messages = [];
  msgsSnap.forEach(doc => { messages.push({ ...doc.data(), _docId: doc.id }); });
  console.log(`  ${messages.length} messages loaded`);

  // 3. 逐則處理
  let totalWrites = 0;
  let skippedHidden = 0;
  let skippedExists = 0;
  let errors = 0;
  let batch = db.batch();
  let batchCount = 0;

  async function flushBatch() {
    if (batchCount === 0) return;
    if (!DRY_RUN) {
      await batch.commit();
    }
    totalWrites += batchCount;
    batch = db.batch();
    batchCount = 0;
  }

  for (let mi = 0; mi < messages.length; mi++) {
    const msg = messages[mi];
    const msgId = msg.id || msg._docId;
    if (!msgId) { errors++; continue; }

    // 展開收件人
    const recipientUids = new Set();
    const targetUid = msg.targetUid || msg.toUid || msg.recipientUid;
    const targetTeamId = msg.targetTeamId;
    const targetRoles = msg.targetRoles;
    const targetType = msg.targetType;

    if (targetUid) {
      recipientUids.add(targetUid);
    } else if (targetTeamId) {
      Object.entries(users).forEach(([uid, u]) => {
        if (u.teamId === targetTeamId) recipientUids.add(uid);
        if (Array.isArray(u.teamIds) && u.teamIds.includes(targetTeamId)) recipientUids.add(uid);
      });
    } else if (Array.isArray(targetRoles) && targetRoles.length > 0) {
      Object.entries(users).forEach(([uid, u]) => {
        if (targetRoles.includes(u.role)) recipientUids.add(uid);
      });
    } else if (targetType === 'all' || (!targetUid && !targetTeamId && (!targetRoles || targetRoles.length === 0))) {
      Object.keys(users).forEach(uid => recipientUids.add(uid));
    }

    // 發送者也能看到自己的訊息
    if (msg.fromUid) recipientUids.add(msg.fromUid);
    if (msg.senderUid) recipientUids.add(msg.senderUid);

    const hiddenBy = Array.isArray(msg.hiddenBy) ? msg.hiddenBy : [];
    const readBy = Array.isArray(msg.readBy) ? msg.readBy : [];

    for (const uid of recipientUids) {
      // 已隱藏 → 跳過
      if (hiddenBy.includes(uid)) { skippedHidden++; continue; }

      const ref = db.collection('users').doc(uid).collection('inbox').doc(msgId);

      // 幂等：已存在 → 跳過
      if (!DRY_RUN) {
        try {
          const existing = await ref.get();
          if (existing.exists) { skippedExists++; continue; }
        } catch (_) {}
      }

      const isRead = readBy.includes(uid) || msg.unread === false;
      const inboxDoc = {
        id: msgId,
        title: String(msg.title || '').slice(0, 200),
        body: String(msg.body || '').slice(0, 2000),
        preview: String(msg.preview || msg.body || '').slice(0, 43),
        type: msg.type || msg.category || 'system',
        typeName: msg.typeName || msg.categoryLabel || '',
        time: msg.time || '',
        senderName: msg.senderName || '',
        fromUid: msg.fromUid || msg.senderUid || null,
        read: isRead,
        readAt: isRead ? FieldValue.serverTimestamp() : null,
        actionType: msg.actionType || null,
        actionStatus: msg.actionStatus || null,
        reviewerName: msg.reviewerName || null,
        meta: msg.meta || null,
        ref: `messages/${msgId}`,
        createdAt: msg.createdAt || msg.timestamp || FieldValue.serverTimestamp(),
      };

      batch.set(ref, inboxDoc);
      batchCount++;

      if (batchCount >= 450) {
        await flushBatch();
        process.stdout.write(`  Progress: ${totalWrites} writes (msg ${mi + 1}/${messages.length})\r`);
      }
    }
  }

  await flushBatch();

  console.log(`\n\n=== Migration Complete ===`);
  console.log(`  Total writes:    ${totalWrites}`);
  console.log(`  Skipped hidden:  ${skippedHidden}`);
  console.log(`  Skipped exists:  ${skippedExists}`);
  console.log(`  Errors:          ${errors}`);
  if (DRY_RUN) console.log(`  (DRY RUN — no data written)`);
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
