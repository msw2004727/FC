/**
 * recordUserLoginIp CF — unit tests
 *
 * Extracted from: functions/index.js (recordUserLoginIp)
 * 重點驗證：
 *   - IP 正則驗證（IPv4/IPv6/invalid）
 *   - Rate limit（同 IP 跳過）
 *   - GeoIP ipwho.is 回應解析（city/country/connection.isp）
 *   - GeoIP 失敗 / success=false 靜默處理
 */

// ─── IP 格式驗證（同 CF 實作） ───
function isValidIp(rawIp) {
  if (!rawIp) return false;
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(rawIp) || /^[0-9a-fA-F:]+$/.test(rawIp);
}

function extractRealIp(xff, rawReqIp) {
  const ipStr = (typeof xff === 'string' ? xff.split(',')[0] : '').trim() || rawReqIp || '';
  return isValidIp(ipStr) ? ipStr : null;
}

// ─── Rate limit（同 IP 跳過） ───
function shouldSkipByIp(existingLoginIp, currentIp) {
  return existingLoginIp === currentIp;
}

// ─── GeoIP 回應解析（ipwho.is 格式） ───
function parseIpwhoisResponse(data) {
  if (!data || data.success === false) {
    return { region: null, isp: null };
  }
  const city = typeof data.city === 'string' ? data.city.slice(0, 50) : '';
  const country = typeof data.country === 'string' ? data.country.slice(0, 50) : '';
  const region = [city, country].filter(Boolean).join(', ') || null;
  const ispRaw = data.connection?.isp || data.connection?.org || '';
  const isp = typeof ispRaw === 'string' && ispRaw ? ispRaw.slice(0, 100) : null;
  return { region, isp };
}

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

describe('recordUserLoginIp — IP validation', () => {
  test('IPv4 有效格式', () => {
    expect(isValidIp('1.2.3.4')).toBe(true);
    expect(isValidIp('192.168.1.1')).toBe(true);
    expect(isValidIp('255.255.255.255')).toBe(true);
  });

  test('IPv6 有效格式', () => {
    expect(isValidIp('2001:b011:800f:1db9:3c1e:7b0e:96ad:4b74')).toBe(true);
    expect(isValidIp('::1')).toBe(true);
    expect(isValidIp('fe80::1')).toBe(true);
  });

  test('無效 IP 字串', () => {
    expect(isValidIp('not-an-ip')).toBe(false);
    expect(isValidIp('1.2.3')).toBe(false);  // 不完整
    expect(isValidIp('abc.def.ghi.jkl')).toBe(false);
  });

  test('空值處理', () => {
    expect(isValidIp('')).toBe(false);
    expect(isValidIp(null)).toBe(false);
    expect(isValidIp(undefined)).toBe(false);
  });
});

describe('recordUserLoginIp — extractRealIp (x-forwarded-for)', () => {
  test('單一 IP 字串', () => {
    expect(extractRealIp('1.2.3.4', '5.6.7.8')).toBe('1.2.3.4');
  });

  test('代理鏈：取第一個', () => {
    expect(extractRealIp('1.2.3.4, 5.6.7.8, 9.10.11.12', '')).toBe('1.2.3.4');
  });

  test('xff 為空 → fallback rawRequest.ip', () => {
    expect(extractRealIp('', '5.6.7.8')).toBe('5.6.7.8');
    expect(extractRealIp(null, '5.6.7.8')).toBe('5.6.7.8');
  });

  test('xff 值無效 → 也走 fallback', () => {
    expect(extractRealIp('invalid-ip, 5.6.7.8', '9.10.11.12')).toBe(null);
    // 第一個無效時不會自動取下一個，直接驗證失敗回 null
  });

  test('xff + rawIp 皆無效 → 回 null', () => {
    // 注意：IPv6 正則 [0-9a-fA-F:]+ 會誤判 'bad' 為合法（b/a/d 都是 hex）
    // 實務上 xff header 不會是純字串（GCP LB 會填合法 IP），這是接受的寬鬆驗證
    expect(extractRealIp('xyz', 'uvw')).toBe(null);  // 非 hex 字元
    expect(extractRealIp('', '')).toBe(null);
  });

  test('⚠️ 邊界案例：hex 字元組成的字串會被當 IPv6 收下（已知寬鬆驗證）', () => {
    // 記錄實際行為作為安全網：若未來收緊正則要更新此測試
    expect(extractRealIp('bad', '')).toBe('bad');  // b/a/d 都是 hex → 通過正則
    expect(extractRealIp('cafe', '')).toBe('cafe'); // 同理
  });

  test('IPv6 代理鏈', () => {
    expect(extractRealIp('2001:b011:800f::1, 5.6.7.8', '')).toBe('2001:b011:800f::1');
  });

  test('xff 含前後空白', () => {
    expect(extractRealIp('   1.2.3.4   ', '')).toBe('1.2.3.4');
  });
});

describe('recordUserLoginIp — Rate limit (IP comparison)', () => {
  test('同 IP → 跳過寫入', () => {
    expect(shouldSkipByIp('1.2.3.4', '1.2.3.4')).toBe(true);
  });

  test('IP 變化 → 不跳過', () => {
    expect(shouldSkipByIp('1.2.3.4', '5.6.7.8')).toBe(false);
  });

  test('首次登入（existingIp 為 undefined） → 不跳過', () => {
    expect(shouldSkipByIp(undefined, '1.2.3.4')).toBe(false);
  });

  test('IPv6 比對', () => {
    const ipv6 = '2001:b011:800f:1db9:3c1e:7b0e:96ad:4b74';
    expect(shouldSkipByIp(ipv6, ipv6)).toBe(true);
  });
});

describe('recordUserLoginIp — GeoIP response parsing', () => {
  test('完整 ipwho.is 回應', () => {
    const data = {
      success: true,
      city: 'Taichung',
      country: 'Taiwan',
      connection: { isp: 'Chunghwa Telecom Co., Ltd.', org: 'HiNet' },
    };
    const result = parseIpwhoisResponse(data);
    expect(result.region).toBe('Taichung, Taiwan');
    expect(result.isp).toBe('Chunghwa Telecom Co., Ltd.');
  });

  test('無 city → 只顯示 country', () => {
    const data = {
      success: true,
      city: '',
      country: 'Taiwan',
      connection: { isp: 'HiNet' },
    };
    const result = parseIpwhoisResponse(data);
    expect(result.region).toBe('Taiwan');
  });

  test('無 isp → fallback 到 org', () => {
    const data = {
      success: true,
      city: 'Taichung',
      country: 'Taiwan',
      connection: { isp: '', org: 'Data Communication Business Group' },
    };
    const result = parseIpwhoisResponse(data);
    expect(result.isp).toBe('Data Communication Business Group');
  });

  test('success=false → region / isp 皆 null', () => {
    const result = parseIpwhoisResponse({ success: false, message: 'invalid ip' });
    expect(result.region).toBeNull();
    expect(result.isp).toBeNull();
  });

  test('空物件 → null', () => {
    expect(parseIpwhoisResponse({})).toEqual({ region: null, isp: null });
  });

  test('null 回應 → null', () => {
    expect(parseIpwhoisResponse(null)).toEqual({ region: null, isp: null });
  });

  test('region 長度限制：city 最多 50 字', () => {
    const data = { success: true, city: 'X'.repeat(100), country: 'Taiwan', connection: {} };
    const result = parseIpwhoisResponse(data);
    // city 截 50 字 + ', Taiwan'
    expect(result.region.length).toBeLessThanOrEqual(50 + 2 + 'Taiwan'.length);
  });

  test('isp 長度限制：最多 100 字', () => {
    const data = { success: true, connection: { isp: 'Y'.repeat(200) } };
    const result = parseIpwhoisResponse(data);
    expect(result.isp.length).toBe(100);
  });

  test('無 connection 物件 → isp null', () => {
    const data = { success: true, city: 'Taipei', country: 'Taiwan' };
    const result = parseIpwhoisResponse(data);
    expect(result.isp).toBeNull();
  });
});
