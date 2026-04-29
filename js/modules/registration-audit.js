/* ================================================
   SportHub — Registration Audit & Repair
   依賴：api-service.js, firebase-crud.js
   用途：掃描所有活動，比對 registrations vs events 投影，輸出差異 / 回寫修正
   ================================================ */

Object.assign(App, {

  /**
   * Audit Mode：只讀檢查，回傳差異清單
   * @returns {Array<Object>} 每筆包含 { eventId, eventTitle, issues: string[] }
   */
  async auditRegistrations() {
    const events = ApiService.getAllEvents ? ApiService.getAllEvents() : (ApiService._src('events') || []);
    const allRegs = ApiService._src('registrations') || [];
    const results = [];

    for (const event of events) {
      const issues = [];
      const eventRegs = allRegs.filter(
        r => r.eventId === event.id && (r.status === 'confirmed' || r.status === 'waitlisted')
      );
      const confirmedRegs = eventRegs.filter(r => r.status === 'confirmed');
      const waitlistedRegs = eventRegs.filter(r => r.status === 'waitlisted');

      // 取得顯示名稱
      const confirmedNames = confirmedRegs.map(r =>
        r.participantType === 'companion'
          ? String(r.companionName || r.userName || '').trim()
          : String(r.userName || '').trim()
      ).filter(Boolean);

      const waitlistedNames = waitlistedRegs.map(r =>
        r.participantType === 'companion'
          ? String(r.companionName || r.userName || '').trim()
          : String(r.userName || '').trim()
      ).filter(Boolean);

      // 1. current !== confirmed 數量
      if ((event.current || 0) !== confirmedRegs.length) {
        issues.push(`current 不一致: event.current=${event.current}, confirmed=${confirmedRegs.length}`);
      }

      // 2. waitlist !== waitlisted 數量
      if ((event.waitlist || 0) !== waitlistedRegs.length) {
        issues.push(`waitlist 不一致: event.waitlist=${event.waitlist}, waitlisted=${waitlistedRegs.length}`);
      }

      // 3. participants 與 confirmed 名單不一致
      const eventParticipants = (event.participants || []).slice().sort();
      const sortedConfirmed = confirmedNames.slice().sort();
      if (JSON.stringify(eventParticipants) !== JSON.stringify(sortedConfirmed)) {
        issues.push(`participants 不一致: event=[${eventParticipants.join(',')}], regs=[${sortedConfirmed.join(',')}]`);
      }

      // 4. waitlistNames 與 waitlisted 名單不一致
      const eventWaitlist = (event.waitlistNames || []).slice().sort();
      const sortedWaitlisted = waitlistedNames.slice().sort();
      if (JSON.stringify(eventWaitlist) !== JSON.stringify(sortedWaitlisted)) {
        issues.push(`waitlistNames 不一致: event=[${eventWaitlist.join(',')}], regs=[${sortedWaitlisted.join(',')}]`);
      }

      // 5. participants 與 waitlistNames 有重疊
      const pSet = new Set(event.participants || []);
      const overlap = (event.waitlistNames || []).filter(n => pSet.has(n));
      if (overlap.length > 0) {
        issues.push(`participants/waitlistNames 重疊: [${overlap.join(',')}]`);
      }

      // 6. current > max
      if ((event.current || 0) > (event.max || 0)) {
        issues.push(`超額: current=${event.current} > max=${event.max}`);
      }

      // 7. 同活動同用戶多筆有效本人報名
      const selfRegs = eventRegs.filter(r => r.participantType !== 'companion');
      const userCounts = {};
      for (const r of selfRegs) {
        userCounts[r.userId] = (userCounts[r.userId] || 0) + 1;
      }
      for (const [uid, count] of Object.entries(userCounts)) {
        if (count > 1) {
          issues.push(`用戶 ${uid} 有 ${count} 筆有效本人報名`);
        }
      }

      if (issues.length > 0) {
        results.push({ eventId: event.id, eventTitle: event.title, issues });
      }
    }

    return results;
  },

  /**
   * Repair Mode：以 registrations 為準，呼叫 _rebuildOccupancy 回寫 events 投影欄位
   * @param {boolean} dryRun - true 時只回傳修正計畫，不實際寫入
   * @returns {Array<Object>} 修正記錄
   */
  async repairRegistrations(dryRun = true) {
    if (typeof FirebaseService === 'undefined' || typeof FirebaseService._rebuildOccupancy !== 'function') {
      throw new Error('FirebaseService._rebuildOccupancy 不可用');
    }

    const events = ApiService._src('events') || [];
    const allRegs = ApiService._src('registrations') || [];
    const repairs = [];

    for (const event of events) {
      if (event.status === 'ended' || event.status === 'cancelled') continue;

      const eventRegs = allRegs.filter(
        r => r.eventId === event.id && (r.status === 'confirmed' || r.status === 'waitlisted')
      );

      const occupancy = FirebaseService._rebuildOccupancy(event, eventRegs);

      // 比對是否需要修正
      const needsFix =
        event.current !== occupancy.current ||
        event.waitlist !== occupancy.waitlist ||
        JSON.stringify((event.participants || []).sort()) !== JSON.stringify(occupancy.participants.sort()) ||
        JSON.stringify((event.waitlistNames || []).sort()) !== JSON.stringify(occupancy.waitlistNames.sort());

      if (!needsFix) continue;

      const repair = {
        eventId: event.id,
        eventTitle: event.title,
        before: {
          current: event.current,
          waitlist: event.waitlist,
          participants: event.participants,
          waitlistNames: event.waitlistNames,
        },
        after: occupancy,
      };

      if (!dryRun) {
        FirebaseService._applyRebuildOccupancy(event, occupancy);
        if (event._docId) {
          try {
            await db.collection('events').doc(event._docId).update({
              current: occupancy.current,
              realCurrent: occupancy.realCurrent,
              waitlist: occupancy.waitlist,
              participants: occupancy.participants,
              waitlistNames: occupancy.waitlistNames,
              participantsWithUid: occupancy.participantsWithUid,
              waitlistWithUid: occupancy.waitlistWithUid,
              teamReservationSummaries: occupancy.teamReservationSummaries,
              schemaVersion: 2,
              status: occupancy.status,
            });
            repair.status = 'fixed';
          } catch (err) {
            console.error('[repairRegistrations]', event.id, err);
            repair.status = 'error';
            repair.error = err.message;
          }
        } else {
          repair.status = 'fixed_local';
        }
      } else {
        repair.status = 'dry_run';
      }

      repairs.push(repair);
    }

    if (!dryRun && typeof FirebaseService._saveToLS === 'function') {
      FirebaseService._saveToLS('events', FirebaseService._cache.events);
    }

    return repairs;
  },

  /**
   * 完整資料校正：修正 registration status + event 投影
   *
   * 規則：
   * - 每個活動的有效報名按 registeredAt ASC 排序
   * - 前 max 名為 confirmed，其餘為 waitlisted
   * - 修正後用 _rebuildOccupancy 重建 event 投影
   *
   * @param {boolean} dryRun - true 時只回傳修正計畫，不實際寫入（預設 true）
   * @returns {Object} { summary, eventDetails[] }
   */
  async repairRegistrationStatuses(dryRun = true) {
    if (typeof FirebaseService === 'undefined' || typeof FirebaseService._rebuildOccupancy !== 'function') {
      throw new Error('FirebaseService._rebuildOccupancy 不可用');
    }

    const events = ApiService._src('events') || [];
    const allRegs = ApiService._src('registrations') || [];
    const eventDetails = [];
    let totalPromoted = 0;
    let totalDemoted = 0;
    let totalEventsFixed = 0;

    for (const event of events) {
      // 跳過已結束/取消的活動
      if (event.status === 'ended' || event.status === 'cancelled') continue;

      const maxSlots = event.max || 0;
      if (maxSlots === 0) continue;

      // 取得該活動所有有效報名
      const activeRegs = allRegs.filter(
        r => r.eventId === event.id && (r.status === 'confirmed' || r.status === 'waitlisted')
      );

      if (activeRegs.length === 0) continue;

      // 按報名時間排序（最早的優先正取）
      activeRegs.sort((a, b) => {
        const ta = new Date(a.registeredAt).getTime();
        const tb = new Date(b.registeredAt).getTime();
        if (ta !== tb) return ta - tb;
        return (a.promotionOrder || 0) - (b.promotionOrder || 0);
      });

      const toPromote = []; // 應該是 confirmed 但目前是 waitlisted
      const toDemote = [];  // 應該是 waitlisted 但目前是 confirmed

      activeRegs.forEach((reg, idx) => {
        const shouldBeConfirmed = idx < maxSlots;
        if (shouldBeConfirmed && reg.status === 'waitlisted') {
          toPromote.push(reg);
        } else if (!shouldBeConfirmed && reg.status === 'confirmed') {
          toDemote.push(reg);
        }
      });

      if (toPromote.length === 0 && toDemote.length === 0) continue;

      // 構建此活動的修正報告
      const getName = (r) => r.participantType === 'companion'
        ? String(r.companionName || r.userName || '').trim()
        : String(r.userName || '').trim();

      const detail = {
        eventId: event.id,
        eventTitle: event.title,
        max: maxSlots,
        totalActive: activeRegs.length,
        promote: toPromote.map(r => ({
          regId: r.id,
          docId: r._docId,
          name: getName(r),
          userId: r.userId,
          type: r.participantType,
          registeredAt: r.registeredAt,
          change: 'waitlisted -> confirmed',
        })),
        demote: toDemote.map(r => ({
          regId: r.id,
          docId: r._docId,
          name: getName(r),
          userId: r.userId,
          type: r.participantType,
          registeredAt: r.registeredAt,
          change: 'confirmed -> waitlisted',
        })),
      };

      if (!dryRun) {
        // 解析 eventDocId（子集合寫入必要）
        var eventDocId = await FirebaseService._getEventDocIdAsync(event.id);
        if (!eventDocId) throw new Error('無法取得活動文件 ID: ' + event.id);
        const batch = db.batch();

        // 遞補：waitlisted → confirmed
        for (const reg of toPromote) {
          reg.status = 'confirmed';
          if (reg._docId) {
            batch.update(db.collection('events').doc(eventDocId).collection('registrations').doc(reg._docId), { status: 'confirmed' });
          }
        }

        // 降級：confirmed → waitlisted
        for (const reg of toDemote) {
          reg.status = 'waitlisted';
          if (reg._docId) {
            batch.update(db.collection('events').doc(eventDocId).collection('registrations').doc(reg._docId), { status: 'waitlisted' });
          }
        }

        // 重建 event 投影
        const updatedActiveRegs = allRegs.filter(
          r => r.eventId === event.id && (r.status === 'confirmed' || r.status === 'waitlisted')
        );
        const occupancy = FirebaseService._rebuildOccupancy(event, updatedActiveRegs);

        if (event._docId) {
          batch.update(db.collection('events').doc(event._docId), {
            current: occupancy.current,
            realCurrent: occupancy.realCurrent,
            waitlist: occupancy.waitlist,
            participants: occupancy.participants,
            waitlistNames: occupancy.waitlistNames,
            participantsWithUid: occupancy.participantsWithUid,
            waitlistWithUid: occupancy.waitlistWithUid,
            teamReservationSummaries: occupancy.teamReservationSummaries,
            schemaVersion: 2,
            status: occupancy.status,
          });
        }

        try {
          await batch.commit();
          FirebaseService._applyRebuildOccupancy(event, occupancy);
          detail.result = 'fixed';
        } catch (err) {
          console.error('[repairStatuses]', event.id, err);
          // rollback local
          for (const reg of toPromote) reg.status = 'waitlisted';
          for (const reg of toDemote) reg.status = 'confirmed';
          detail.result = 'error';
          detail.error = err.message;
        }
      } else {
        detail.result = 'dry_run';
      }

      totalPromoted += toPromote.length;
      totalDemoted += toDemote.length;
      totalEventsFixed++;
      eventDetails.push(detail);
    }

    if (!dryRun) {
      FirebaseService._saveToLS('registrations', FirebaseService._cache.registrations);
      FirebaseService._saveToLS('events', FirebaseService._cache.events);
    }

    const summary = {
      mode: dryRun ? 'DRY RUN（預覽，未寫入）' : 'LIVE（已寫入 Firestore）',
      eventsScanned: events.filter(e => e.status !== 'ended' && e.status !== 'cancelled').length,
      eventsNeedFix: totalEventsFixed,
      totalPromoted,
      totalDemoted,
    };

    // 輸出人類可讀的摘要到 console
    console.log('═══════════════════════════════════════');
    console.log(`  報名狀態校正 — ${summary.mode}`);
    console.log('═══════════════════════════════════════');
    console.log(`  掃描活動數: ${summary.eventsScanned}`);
    console.log(`  需修正活動: ${summary.eventsNeedFix}`);
    console.log(`  遞補（候補→正取）: ${summary.totalPromoted} 人`);
    console.log(`  降級（正取→候補）: ${summary.totalDemoted} 人`);
    console.log('───────────────────────────────────────');
    for (const d of eventDetails) {
      console.log(`\n【${d.eventTitle}】(max=${d.max}, 有效報名=${d.totalActive})`);
      if (d.promote.length > 0) {
        console.log('  ▲ 遞補為正取:');
        d.promote.forEach(p => console.log(`    - ${p.name} (${p.type}, 報名時間: ${p.registeredAt})`));
      }
      if (d.demote.length > 0) {
        console.log('  ▼ 降回候補:');
        d.demote.forEach(p => console.log(`    - ${p.name} (${p.type}, 報名時間: ${p.registeredAt})`));
      }
      console.log(`  結果: ${d.result}${d.error ? ' — ' + d.error : ''}`);
    }
    console.log('\n═══════════════════════════════════════');

    return { summary, eventDetails };
  },
});
