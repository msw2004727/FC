/* ================================================================
   SportHub — 重建前診斷腳本
   檢查現有集合狀態 + events 中可用的 participants 資料
   在瀏覽器 console 中執行
   ================================================================ */

async function diagnosisBeforeRebuild() {
  const db = firebase.firestore();

  // 1. 檢查三個集合目前剩餘數量
  const regSnap = await db.collection('registrations').get();
  const arSnap = await db.collection('activityRecords').get();
  const attSnap = await db.collection('attendanceRecords').get();

  // 2. 檢查 events 中的 participants 資料
  const eventsSnap = await db.collection('events').get();
  let totalEvents = 0;
  let eventsWithParticipants = 0;
  let totalParticipantNames = 0;
  let totalWaitlistNames = 0;
  let endedEvents = 0;
  let endedWithParticipants = 0;

  eventsSnap.docs.forEach(d => {
    const data = d.data();
    totalEvents++;
    const participants = Array.isArray(data.participants) ? data.participants : [];
    const waitlist = Array.isArray(data.waitlistNames) ? data.waitlistNames : [];

    if (participants.length > 0 || waitlist.length > 0) {
      eventsWithParticipants++;
      totalParticipantNames += participants.length;
      totalWaitlistNames += waitlist.length;
    }

    if (data.status === 'ended') {
      endedEvents++;
      if (participants.length > 0) endedWithParticipants++;
    }
  });

  // 3. 檢查用戶
  const usersSnap = await db.collection('users').get();

  // 4. 列出前 5 個有 participants 的活動作為樣本
  const samples = [];
  eventsSnap.docs.forEach(d => {
    const data = d.data();
    if (samples.length < 5 && Array.isArray(data.participants) && data.participants.length > 0) {
      samples.push({
        id: data.id || d.id,
        title: data.title || data.name || '?',
        status: data.status,
        participants: data.participants,
        waitlistNames: data.waitlistNames || [],
        current: data.current,
        date: data.date,
      });
    }
  });

  const report = [
    '========== 重建前診斷 ==========',
    '',
    '【現有集合狀態】',
    `  registrations：${regSnap.size} 筆`,
    `  activityRecords：${arSnap.size} 筆`,
    `  attendanceRecords：${attSnap.size} 筆`,
    '',
    '【活動資料可用性】',
    `  活動總數：${totalEvents}`,
    `  有 participants 的活動：${eventsWithParticipants}`,
    `  participants 總人次：${totalParticipantNames}`,
    `  waitlistNames 總人次：${totalWaitlistNames}`,
    `  已結束活動：${endedEvents}`,
    `  已結束 + 有 participants 的活動：${endedWithParticipants}`,
    '',
    `【用戶數】${usersSnap.size}`,
    '',
    '【樣本活動（前 5 個有 participants 的）】',
    ...samples.map(s => [
      `  ${s.title} (${s.id})`,
      `    狀態: ${s.status}, 日期: ${s.date}`,
      `    正取: [${s.participants.join(', ')}]`,
      `    候補: [${s.waitlistNames.join(', ')}]`,
    ].join('\n')),
    '',
    '========== 診斷結束 ==========',
    '',
    '如果 participants 總人次 > 0，可以執行 rebuild-records.js 重建紀錄。',
  ].join('\n');

  console.log(report);
  alert(report);
  return { regSnap: regSnap.size, arSnap: arSnap.size, attSnap: attSnap.size, totalEvents, eventsWithParticipants, totalParticipantNames };
}

diagnosisBeforeRebuild().then(r => console.log('Done', r)).catch(e => console.error('Fatal', e));
