/**
 * 簽到簽退紀錄復原 + 空備註清除 二合一腳本
 *
 * 用途：復原因 _confirmAllAttendance UID 不匹配 bug 被誤刪的簽到紀錄，
 *        並移除同時被寫入的空備註紀錄（讓原始備註重新露出）
 *
 * 使用方式：以管理員身份登入後，在瀏覽器 console 貼入執行
 */

(async function recoverAll() {
  'use strict';

  // ═══ 設定區 ═══
  var TARGET_EVENT_IDS = [
    'WWKZOwMZUsjpCHn1QMx1',
    'YDF6mhUAdx8Vveo1dGiA',
    'ioFsJVBL0Ci6B3xQrepP',
    'nEJVZSG2zMPKiJtdvtfC',
    'ocn0i15AAWZs00JO5hzW',
  ];

  // 時間範圍（預設過去 48 小時，涵蓋更寬）
  var SINCE = new Date(Date.now() - 48 * 60 * 60 * 1000);
  var UNTIL = new Date();

  // true=預覽, false=正式執行
  var DRY_RUN = true;
  // ═══ 設定區結束 ═══

  console.log('=== 簽到紀錄復原 + 空備註清除 ===');
  console.log('模式:', DRY_RUN ? '預覽（不會寫入）' : '正式執行');
  console.log('活動:', TARGET_EVENT_IDS.join(', '));

  if (typeof db === 'undefined') {
    console.error('db 未定義，請確認已登入且 Firebase 已初始化');
    return;
  }

  var toRecover = [];   // status=removed 的簽到簽退要恢復
  var toRemoveNotes = []; // 空備註要標記 removed

  for (var ei = 0; ei < TARGET_EVENT_IDS.length; ei++) {
    var eventId = TARGET_EVENT_IDS[ei];

    // ── Part 1: 找被軟刪除的簽到簽退紀錄 ──
    var snap1 = await db.collection('attendanceRecords')
      .where('eventId', '==', eventId)
      .where('status', '==', 'removed')
      .get();

    snap1.forEach(function(doc) {
      var d = doc.data();
      var removedAt = d.removedAt;
      var removedDate = null;

      if (removedAt && typeof removedAt.toDate === 'function') {
        removedDate = removedAt.toDate();
      } else if (removedAt && typeof removedAt.seconds === 'number') {
        removedDate = new Date(removedAt.seconds * 1000);
      } else if (typeof removedAt === 'string') {
        removedDate = new Date(removedAt);
      }

      if (!removedDate || removedDate < SINCE || removedDate > UNTIL) return;

      toRecover.push({
        docId: doc.id,
        eventId: d.eventId,
        uid: d.uid,
        userName: d.userName,
        type: d.type,
        removedAt: removedDate.toISOString(),
        removedByUid: d.removedByUid || '',
      });
    });

    // ── Part 2: 找 bug 寫入的空備註紀錄 ──
    var snap2 = await db.collection('attendanceRecords')
      .where('eventId', '==', eventId)
      .where('type', '==', 'note')
      .get();

    snap2.forEach(function(doc) {
      var d = doc.data();
      if ((d.note || '').trim() !== '') return;  // 有內容的不動
      if (d.status === 'removed') return;         // 已移除的不重複

      var created = d.createdAt;
      var createdDate = null;
      if (created && typeof created.toDate === 'function') {
        createdDate = created.toDate();
      } else if (created && typeof created.seconds === 'number') {
        createdDate = new Date(created.seconds * 1000);
      }

      if (!createdDate || createdDate < SINCE || createdDate > UNTIL) return;

      toRemoveNotes.push({
        docId: doc.id,
        eventId: d.eventId,
        uid: d.uid,
        userName: d.userName,
        created: createdDate.toISOString(),
      });
    });
  }

  // ── 報告 ──
  console.log('\n--- Part 1: 被誤刪的簽到簽退（將恢復） ---');
  console.log('共', toRecover.length, '筆');
  if (toRecover.length) {
    console.table(toRecover.map(function(r) {
      return { docId: r.docId, eventId: r.eventId, userName: r.userName, type: r.type, removedAt: r.removedAt };
    }));
  }

  console.log('\n--- Part 2: bug 寫入的空備註（將移除） ---');
  console.log('共', toRemoveNotes.length, '筆');
  if (toRemoveNotes.length) {
    console.table(toRemoveNotes.map(function(r) {
      return { docId: r.docId, eventId: r.eventId, userName: r.userName, created: r.created };
    }));
  }

  var total = toRecover.length + toRemoveNotes.length;
  if (total === 0) {
    console.log('\n沒有需要處理的紀錄。');
    return;
  }

  if (DRY_RUN) {
    console.log('\n=== 預覽結束 ===');
    console.log('確認無誤後，將 DRY_RUN 改為 false 再次執行');
    return;
  }

  // ── 正式執行 ──
  var batch = db.batch();
  var count = 0;

  // Part 1: 恢復被誤刪的簽到簽退
  for (var i = 0; i < toRecover.length; i++) {
    batch.update(db.collection('attendanceRecords').doc(toRecover[i].docId), {
      status: firebase.firestore.FieldValue.delete(),
      removedAt: firebase.firestore.FieldValue.delete(),
      removedByUid: firebase.firestore.FieldValue.delete(),
    });
    count++;
    if (count % 450 === 0) {
      console.log('提交 batch...', count, '/', total);
      await batch.commit();
      batch = db.batch();
    }
  }

  // Part 2: 移除空備註
  for (var j = 0; j < toRemoveNotes.length; j++) {
    batch.update(db.collection('attendanceRecords').doc(toRemoveNotes[j].docId), {
      status: 'removed',
      removedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    count++;
    if (count % 450 === 0) {
      console.log('提交 batch...', count, '/', total);
      await batch.commit();
      batch = db.batch();
    }
  }

  if (count % 450 !== 0) {
    await batch.commit();
  }

  console.log('\n=== 全部完成 ===');
  console.log('恢復簽到簽退:', toRecover.length, '筆');
  console.log('移除空備註:', toRemoveNotes.length, '筆');
  console.log('請重新整理頁面確認結果');
})();
