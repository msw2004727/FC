const fs = require('fs');
const path = require('path');

describe('privacy policy content', () => {
  const root = path.resolve(__dirname, '..', '..');
  const source = fs.readFileSync(path.join(root, 'privacy.html'), 'utf8');

  test('covers GPS, email, map services, retention, and platform protection terms', () => {
    expect(source).toContain('最後更新日期：2026 年 5 月 19 日');
    expect(source).toContain('二之一、精確地理位置（GPS）使用說明');
    expect(source).toContain('二之二、電子郵件使用說明');
    expect(source).toContain('Google Maps Platform');
    expect(source).toContain('附近活動使用之目前位置僅於當次功能執行時短暫使用');
    expect(source).toContain('本服務不會出售您的電子郵件');
    expect(source).toContain('十二、使用者義務與責任限制');
  });
});
