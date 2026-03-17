/* ================================================================
   SportHub — 資料重建腳本
   從 events.participants / waitlistNames 重建
   registrations、activityRecords、attendanceRecords

   在瀏覽器 console 中以管理員身分執行
   ================================================================ */

async function rebuildAllRecords() {
  const db = firebase.firestore();

  // ── Step 1: 載入所有用戶 ──
  alert('開始重建：載入用戶資料...');
  const usersSnap = await db.collection('users').get();
  const users = [];
  usersSnap.docs.forEach(d => {
    const data = d.data();
    users.push({ ...data, _docId: d.id });
  });
  console.log(`載入 ${users.length} 位用戶`);

  // 建立 name → uid 對映（多對一時用最新更新的）
  const nameToUidMap = new Map();
  users.forEach(u => {
    const name = (u.displayName || u.name || '').trim();
    const uid = (u.uid || u.lineUserId || u._docId || '').trim();
    if (name && uid) {
      // 若同名已存在，保留有 lineUserId 的那個
      if (!nameToUidMap.has(name) || u.lineUserId) {
        nameToUidMap.set(name, uid);
      }
    }
  });
  console.log(`name→uid 對映 ${nameToUidMap.size} 筆`);

  // ── Step 2: 載入所有活動 ──
  alert('載入活動資料...');
  const eventsSnap = await db.collection('events').get();
  const events = [];
  eventsSnap.docs.forEach(d => {
    const data = d.data();
    events.push({ ...data, _docId: d.id });
  });
  console.log(`載入 ${events.length} 個活動`);

  // ── Step 3: 檢查現有紀錄數量 ──
  const existingRegSnap = await db.collection('registrations').get();
  const existingArSnap = await db.collection('activityRecords').get();
  const existingAttSnap = await db.collection('attendanceRecords').get();
  console.log(`現有 registrations: ${existingRegSnap.size}, activityRecords: ${existingArSnap.size}, attendanceRecords: ${existingAttSnap.size}`);

  // 收集已存在的紀錄，避免重複
  const existingRegKeys = new Set();
  existingRegSnap.docs.forEach(d => {
    const data = d.data();
    existingRegKeys.add(`${data.eventId}_${data.userId}_${data.participantType || 'self'}_${data.companionName || ''}`);
  });

  const existingArKeys = new Set();
  existingArSnap.docs.forEach(d => {
    const data = d.data();
    existingArKeys.add(`${data.eventId}_${data.uid}_${data.status}`);
  });

  const existingAttKeys = new Set();
  existingAttSnap.docs.forEach(d => {
    const data = d.data();
    existingAttKeys.add(`${data.eventId}_${data.uid}_${data.type}`);
  });

  // ── Step 4: 重建 registrations + activityRecords ──
  let regCount = 0, arCount = 0, attCount = 0;
  let skipReg = 0, skipAr = 0, skipAtt = 0;
  let unmappedNames = new Set();
  let errorCount = 0;

  const BATCH_SIZE = 450;
  let batch = db.batch();
  let batchCount = 0;

  async function flushBatch() {
    if (batchCount > 0) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  for (let ei = 0; ei < events.length; ei++) {
    const event = events[ei];
    const eventId = (event.id || '').trim();
    if (!eventId) continue;

    const participants = Array.isArray(event.participants) ? event.participants : [];
    const waitlistNames = Array.isArray(event.waitlistNames) ? event.waitlistNames : [];
    const eventTitle = event.title || event.name || '未命名';
    const eventType = event.type || '';
    const eventDate = event.date || '';
    const eventStatus = event.status || '';

    // 解析日期為 MM/DD
    let dateStr = '';
    if (eventDate) {
      const parts = eventDate.split(' ')[0].split('/');
      if (parts.length >= 3) dateStr = `${parts[1]}/${parts[2]}`;
      else if (parts.length === 2) dateStr = eventDate.split(' ')[0];
    }

    // 處理正取名單
    for (const name of participants) {
      const safeName = (name || '').trim();
      if (!safeName) continue;

      const uid = nameToUidMap.get(safeName);
      if (!uid) {
        unmappedNames.add(safeName);
        continue;
      }

      // registration
      const regKey = `${eventId}_${uid}_self_`;
      if (!existingRegKeys.has(regKey)) {
        try {
          const regRef = db.collection('registrations').doc();
          batch.set(regRef, {
            id: 'reg_rebuild_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
            eventId,
            userId: uid,
            userName: safeName,
            participantType: 'self',
            promotionOrder: 0,
            status: 'confirmed',
            registeredAt: firebase.firestore.FieldValue.serverTimestamp(),
            _rebuilt: true,
          });
          batchCount++;
          regCount++;
          existingRegKeys.add(regKey);
        } catch (err) {
          console.error(`reg error: ${safeName} @ ${eventId}`, err);
          errorCount++;
        }
      } else {
        skipReg++;
      }

      // activityRecord
      const arKey = `${eventId}_${uid}_registered`;
      if (!existingArKeys.has(arKey)) {
        try {
          const arRef = db.collection('activityRecords').doc();
          batch.set(arRef, {
            eventId,
            name: eventTitle,
            date: dateStr,
            status: 'registered',
            uid,
            eventType,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            _rebuilt: true,
          });
          batchCount++;
          arCount++;
          existingArKeys.add(arKey);
        } catch (err) {
          console.error(`ar error: ${safeName} @ ${eventId}`, err);
          errorCount++;
        }
      } else {
        skipAr++;
      }

      // attendanceRecord (只有已結束的活動才建立簽到簽退)
      if (eventStatus === 'ended') {
        // checkin
        const attKeyIn = `${eventId}_${uid}_checkin`;
        if (!existingAttKeys.has(attKeyIn)) {
          try {
            const attRef = db.collection('attendanceRecords').doc();
            batch.set(attRef, {
              id: 'att_rebuild_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
              eventId,
              uid,
              userName: safeName,
              participantType: 'self',
              companionId: null,
              companionName: null,
              type: 'checkin',
              time: eventDate || new Date().toISOString(),
              status: 'active',
              createdAt: firebase.firestore.FieldValue.serverTimestamp(),
              _rebuilt: true,
            });
            batchCount++;
            attCount++;
            existingAttKeys.add(attKeyIn);
          } catch (err) {
            errorCount++;
          }
        } else {
          skipAtt++;
        }

        // checkout
        const attKeyOut = `${eventId}_${uid}_checkout`;
        if (!existingAttKeys.has(attKeyOut)) {
          try {
            const attRef = db.collection('attendanceRecords').doc();
            batch.set(attRef, {
              id: 'att_rebuild_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
              eventId,
              uid,
              userName: safeName,
              participantType: 'self',
              companionId: null,
              companionName: null,
              type: 'checkout',
              time: eventDate || new Date().toISOString(),
              status: 'active',
              createdAt: firebase.firestore.FieldValue.serverTimestamp(),
              _rebuilt: true,
            });
            batchCount++;
            attCount++;
            existingAttKeys.add(attKeyOut);
          } catch (err) {
            errorCount++;
          }
        } else {
          skipAtt++;
        }
      }

      // flush if batch is large
      if (batchCount >= BATCH_SIZE) {
        await flushBatch();
        console.log(`進度：活動 ${ei + 1}/${events.length}, reg=${regCount}, ar=${arCount}, att=${attCount}`);
      }
    }

    // 處理候補名單
    for (const name of waitlistNames) {
      const safeName = (name || '').trim();
      if (!safeName) continue;

      const uid = nameToUidMap.get(safeName);
      if (!uid) {
        unmappedNames.add(safeName);
        continue;
      }

      // registration (waitlisted)
      const regKey = `${eventId}_${uid}_self_`;
      if (!existingRegKeys.has(regKey)) {
        try {
          const regRef = db.collection('registrations').doc();
          batch.set(regRef, {
            id: 'reg_rebuild_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
            eventId,
            userId: uid,
            userName: safeName,
            participantType: 'self',
            promotionOrder: 0,
            status: 'waitlisted',
            registeredAt: firebase.firestore.FieldValue.serverTimestamp(),
            _rebuilt: true,
          });
          batchCount++;
          regCount++;
          existingRegKeys.add(regKey);
        } catch (err) {
          errorCount++;
        }
      } else {
        skipReg++;
      }

      // activityRecord (waitlisted)
      const arKey = `${eventId}_${uid}_waitlisted`;
      if (!existingArKeys.has(arKey)) {
        try {
          const arRef = db.collection('activityRecords').doc();
          batch.set(arRef, {
            eventId,
            name: eventTitle,
            date: dateStr,
            status: 'waitlisted',
            uid,
            eventType,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            _rebuilt: true,
          });
          batchCount++;
          arCount++;
          existingArKeys.add(arKey);
        } catch (err) {
          errorCount++;
        }
      } else {
        skipAr++;
      }

      if (batchCount >= BATCH_SIZE) {
        await flushBatch();
      }
    }

    // 定期 flush
    if (batchCount >= BATCH_SIZE) {
      await flushBatch();
    }
  }

  // 最後一批
  await flushBatch();

  // ── 結果報告 ──
  const report = [
    '========== 資料重建完成 ==========',
    `活動數：${events.length}`,
    `用戶數：${users.length}`,
    `name→uid 對映：${nameToUidMap.size}`,
    '',
    `新增 registrations：${regCount} 筆`,
    `新增 activityRecords：${arCount} 筆`,
    `新增 attendanceRecords：${attCount} 筆`,
    '',
    `跳過（已存在）reg：${skipReg}`,
    `跳過（已存在）ar：${skipAr}`,
    `跳過（已存在）att：${skipAtt}`,
    `錯誤數：${errorCount}`,
    '',
    `無法對映的名稱（${unmappedNames.size} 個）：`,
    ...[...unmappedNames].slice(0, 30).map(n => `  - ${n}`),
    unmappedNames.size > 30 ? `  ... 還有 ${unmappedNames.size - 30} 個` : '',
  ].join('\n');

  console.log(report);
  alert(report);
  return { regCount, arCount, attCount, errorCount, unmappedNames: [...unmappedNames] };
}

// 執行
rebuildAllRecords().then(r => console.log('Done', r)).catch(e => console.error('Fatal', e));
