/**
 * 簽到紀錄復原腳本
 *
 * 用途：復原因 _confirmAllAttendance UID 不匹配 bug 被誤刪的簽到紀錄
 *
 * 使用方式：以管理員身份登入後，在瀏覽器 console 貼入執行
 *
 * 原理：removeAttendanceRecord 是軟刪除（status='removed'），
 *        此腳本將 status='removed' 且 removedAt 在指定時間範圍內的紀錄恢復
 */

(async function recoverAttendanceRecords() {
  'use strict';

  // ═══ 設定區 ═══
  // 指定要復原的活動 ID（留空則搜尋所有活動）
  const TARGET_EVENT_ID = '';

  // 指定 removedAt 時間範圍（ISO 格式），只復原此時間範圍內被刪的紀錄
  // 預設：過去 24 小時
  const SINCE = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const UNTIL = new Date().toISOString();

  // 設為 true 才會實際寫入，false 只預覽
  const DRY_RUN = true;
  // ═══ 設定區結束 ═══

  console.log('=== 簽到紀錄復原腳本 ===');
  console.log('模式:', DRY_RUN ? '預覽（不會寫入）' : '正式執行');
  console.log('時間範圍:', SINCE, '~', UNTIL);
  if (TARGET_EVENT_ID) console.log('限定活動:', TARGET_EVENT_ID);

  if (typeof db === 'undefined') {
    console.error('db 未定義，請確認已登入且 Firebase 已初始化');
    return;
  }

  // 查詢所有 status=removed 的紀錄
  let query = db.collection('attendanceRecords').where('status', '==', 'removed');
  if (TARGET_EVENT_ID) {
    query = query.where('eventId', '==', TARGET_EVENT_ID);
  }

  const snapshot = await query.get();
  console.log('找到 status=removed 紀錄:', snapshot.size, '筆');

  const toRecover = [];
  snapshot.forEach(function(doc) {
    const data = doc.data();
    const removedAt = data.removedAt;
    let removedAtStr = '';

    if (removedAt && typeof removedAt.toDate === 'function') {
      removedAtStr = removedAt.toDate().toISOString();
    } else if (typeof removedAt === 'string') {
      removedAtStr = removedAt;
    } else if (removedAt && typeof removedAt.seconds === 'number') {
      removedAtStr = new Date(removedAt.seconds * 1000).toISOString();
    }

    if (removedAtStr && removedAtStr >= SINCE && removedAtStr <= UNTIL) {
      toRecover.push({
        docId: doc.id,
        eventId: data.eventId,
        uid: data.uid,
        userName: data.userName,
        type: data.type,
        removedAt: removedAtStr,
        removedByUid: data.removedByUid || '(unknown)',
      });
    }
  });

  console.log('符合時間範圍的紀錄:', toRecover.length, '筆');

  if (toRecover.length === 0) {
    console.log('沒有需要復原的紀錄。');
    console.log('提示：如果確定有被刪紀錄，請調整 SINCE/UNTIL 時間範圍或 TARGET_EVENT_ID');
    return;
  }

  // 列出將被復原的紀錄
  console.table(toRecover.map(function(r) {
    return {
      docId: r.docId,
      eventId: r.eventId,
      userName: r.userName,
      type: r.type,
      removedAt: r.removedAt,
      removedByUid: r.removedByUid,
    };
  }));

  if (DRY_RUN) {
    console.log('\n=== 預覽模式結束 ===');
    console.log('確認無誤後，將 DRY_RUN 改為 false 再次執行即可復原');
    return;
  }

  // 正式復原
  var batch = db.batch();
  var count = 0;

  for (var i = 0; i < toRecover.length; i++) {
    var rec = toRecover[i];
    var ref = db.collection('attendanceRecords').doc(rec.docId);
    batch.update(ref, {
      status: firebase.firestore.FieldValue.delete(),
      removedAt: firebase.firestore.FieldValue.delete(),
      removedByUid: firebase.firestore.FieldValue.delete(),
    });
    count++;

    // Firestore batch 最多 500 筆
    if (count % 450 === 0) {
      console.log('提交 batch...', count, '/', toRecover.length);
      await batch.commit();
      batch = db.batch();
    }
  }

  if (count % 450 !== 0) {
    await batch.commit();
  }

  console.log('=== 復原完成 ===');
  console.log('共復原', count, '筆紀錄');
  console.log('請重新整理頁面確認結果');
})();
