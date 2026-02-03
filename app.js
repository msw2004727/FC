/**
 * ==========================================
 * KICKOFF 足球報名系統 - JavaScript 應用程式
 * ==========================================
 * 
 * 架構說明：
 * - App 物件：主應用程式控制器
 * - Data 物件：資料管理（Firebase 連接）
 * - UI 物件：介面渲染
 * - Utils 物件：工具函數
 */

// ==========================================
// [區塊1] 設定區 - Firebase & LINE LIFF
// ==========================================
const CONFIG = {
    // ⚠️ 請填入您的 Firebase 設定
    firebase: {
        apiKey: "YOUR_API_KEY",
        authDomain: "YOUR_PROJECT.firebaseapp.com",
        projectId: "YOUR_PROJECT_ID",
        storageBucket: "YOUR_PROJECT.appspot.com",
        messagingSenderId: "YOUR_SENDER_ID",
        appId: "YOUR_APP_ID"
    },
    // ⚠️ 請填入您的 LINE LIFF ID
    liffId: "YOUR_LIFF_ID"
};

// ==========================================
// [區塊2] 全域變數與 Demo 資料
// ==========================================
let db = null;
let storage = null;
let currentUser = null;
let currentEventId = null;
let charts = {};

const DEMO_EVENTS = [
    {
        id: '1',
        name: '週六下午友誼賽',
        banner: 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=600&h=300&fit=crop',
        date: '2025-02-08',
        time: '14:00',
        location: '台北市大安運動中心足球場',
        price: 200,
        capacity: 20,
        registrations: 18,
        waitlist: 2,
        isOpen: true,
        description: '歡迎各路好手一起來踢球！程度不限，重在參與。\n\n活動流程：\n14:00 集合\n14:15 熱身\n14:30 分組比賽\n16:30 結束'
    },
    {
        id: '2',
        name: '週日早晨活力踢',
        banner: 'https://images.unsplash.com/photo-1431324155629-1a6deb1dec8d?w=600&h=300&fit=crop',
        date: '2025-02-09',
        time: '08:00',
        location: '新北市三重足球場',
        price: 150,
        capacity: 16,
        registrations: 16,
        waitlist: 5,
        isOpen: true,
        description: '早起的鳥兒有球踢！清晨踢球，活力一整天。'
    },
    {
        id: '3',
        name: '教練指導訓練營',
        banner: 'https://images.unsplash.com/photo-1517466787929-bc90951d0974?w=600&h=300&fit=crop',
        date: '2025-02-15',
        time: '10:00',
        location: '台中市足球訓練中心',
        price: 500,
        capacity: 12,
        registrations: 8,
        waitlist: 0,
        isOpen: true,
        description: '專業教練帶你提升技術，適合想進步的球友。'
    }
];

const DEMO_LEADERBOARD = [
    { rank: 1, name: '足球王子', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=prince', points: 580, tags: ['MVP', '進球王'] },
    { rank: 2, name: '閃電俠', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=flash', points: 520, tags: ['助攻王'] },
    { rank: 3, name: '鐵壁守護', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=guard', points: 485, tags: ['最佳防守'] },
    { rank: 4, name: '中場大師', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=master', points: 450, tags: ['控球王'] },
    { rank: 5, name: '黃金左腳', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=golden', points: 420, tags: [] },
    { rank: 6, name: '鋼鐵門神', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=keeper', points: 395, tags: ['零封王'] },
    { rank: 7, name: '風之子', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=wind', points: 370, tags: [] },
    { rank: 8, name: '戰術家', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=tactician', points: 345, tags: [] }
];

// ==========================================
// [區塊3] 工具函數
// ==========================================
const Utils = {
    $(id) { return document.getElementById(id); },
    
    $$(selector) { return document.querySelectorAll(selector); },
    
    getRoleText(role) {
        return { rookie: '新手', veteran: '老手', coach: '教練', admin: '管理者' }[role] || '新手';
    },
    
    animateNumber(elementId, target) {
        const el = this.$(elementId);
        if (!el) return;
        let current = 0;
        const increment = target / 50;
        const timer = setInterval(() => {
            current += increment;
            if (current >= target) { current = target; clearInterval(timer); }
            el.textContent = Math.floor(current);
        }, 30);
    },
    
    showToast(message, type = 'info') {
        const container = this.$('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
        toast.innerHTML = `<span style="font-size:1.2rem">${icons[type]}</span><span>${message}</span>`;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = 'slideIn 0.3s ease reverse';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
};

// ==========================================
// [區塊4] 資料管理
// ==========================================
const Data = {
    async init() {
        try {
            if (CONFIG.firebase.apiKey !== "YOUR_API_KEY") {
                firebase.initializeApp(CONFIG.firebase);
                db = firebase.firestore();
                storage = firebase.storage();
                console.log('✅ Firebase 初始化成功');
            } else {
                console.warn('⚠️ 請設定 Firebase 配置');
            }
        } catch (error) {
            console.error('Firebase 初始化失敗:', error);
        }
    },
    
    async initLiff() {
        try {
            if (CONFIG.liffId !== "YOUR_LIFF_ID") {
                await liff.init({ liffId: CONFIG.liffId });
                console.log('✅ LIFF 初始化成功');
                if (liff.isLoggedIn()) await App.handleLineProfile();
            } else {
                console.warn('⚠️ 請設定 LINE LIFF ID');
            }
        } catch (error) {
            console.error('LIFF 初始化失敗:', error);
        }
    },
    
    async syncUser() {
        if (!db || !currentUser) return;
        try {
            const userRef = db.collection('users').doc(currentUser.uid);
            const doc = await userRef.get();
            if (doc.exists) currentUser = { ...currentUser, ...doc.data() };
            else await userRef.set(currentUser);
        } catch (error) {
            console.error('同步用戶資料失敗:', error);
        }
    },
    
    async saveUser() {
        if (!db || !currentUser) return;
        try {
            await db.collection('users').doc(currentUser.uid).update(currentUser);
        } catch (error) {
            console.error('儲存用戶資料失敗:', error);
        }
    },
    
    getEvents() {
        return DEMO_EVENTS;
    },
    
    getLeaderboard() {
        return DEMO_LEADERBOARD;
    }
};

// ==========================================
// [區塊5] UI 渲染
// ==========================================
const UI = {
    renderEvents(events, containerId, limit = null) {
        const container = Utils.$(containerId);
        if (!container) return;
        const eventsToRender = limit ? events.slice(0, limit) : events;
        
        if (eventsToRender.length === 0) {
            container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📭</div><div class="empty-state-title">目前沒有活動</div></div>`;
            return;
        }
        
        container.innerHTML = eventsToRender.map(event => {
            const isFull = event.registrations >= event.capacity;
            const fillPercent = (event.registrations / event.capacity) * 100;
            const statusClass = !event.isOpen ? 'closed' : isFull ? 'full' : 'open';
            const statusText = !event.isOpen ? '已關閉' : isFull ? '已額滿' : '開放報名';
            const capacityClass = fillPercent >= 100 ? 'full' : fillPercent >= 80 ? 'warning' : '';
            
            return `
                <div class="event-card" onclick="App.openEventDetail('${event.id}')">
                    <div class="event-banner">
                        <img src="${event.banner}" alt="${event.name}" onerror="this.src='https://via.placeholder.com/600x300/2d8a4e/ffffff?text=⚽'">
                        <span class="event-status ${statusClass}">${statusText}</span>
                    </div>
                    <div class="event-content">
                        <h3 class="event-title">${event.name}</h3>
                        <div class="event-meta">
                            <div class="event-meta-item"><span class="icon">📅</span><span>${event.date} ${event.time}</span></div>
                            <div class="event-meta-item"><span class="icon">📍</span><span>${event.location}</span></div>
                        </div>
                        <div class="event-price">NT$ ${event.price} <span>/ 人</span></div>
                        <div class="event-capacity">
                            <div class="capacity-bar"><div class="capacity-fill ${capacityClass}" style="width:${Math.min(fillPercent,100)}%"></div></div>
                            <div class="capacity-text"><span>已報名 ${event.registrations} 人</span><span>上限 ${event.capacity} 人</span></div>
                            ${event.waitlist > 0 ? `<span class="text-muted">候補 ${event.waitlist} 人</span>` : ''}
                        </div>
                        <div class="event-actions">
                            <button class="btn btn-primary btn-sm w-100" onclick="event.stopPropagation();App.handleQuickRegister('${event.id}')">${isFull ? '加入候補' : '立即報名'}</button>
                        </div>
                    </div>
                </div>`;
        }).join('');
    },
    
    renderLeaderboard(data) {
        const container = Utils.$('leaderboardList');
        if (!container) return;
        
        container.innerHTML = data.map(item => `
            <div class="leaderboard-item ${item.rank <= 3 ? `top-${item.rank}` : ''}">
                <div class="leaderboard-rank">#${item.rank}</div>
                <img src="${item.avatar}" alt="${item.name}" class="leaderboard-avatar">
                <div class="leaderboard-info">
                    <div class="leaderboard-name">${item.name}</div>
                    <div class="leaderboard-tags">${item.tags.map(tag => `<span class="badge badge-gold">${tag}</span>`).join('')}</div>
                </div>
                <div class="leaderboard-score">${item.points}</div>
            </div>`).join('');
    },
    
    renderRegistrationList() {
        const registrations = [
            { uid: '1', name: '小明', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=1', checkedIn: true },
            { uid: '2', name: '小華', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=2', checkedIn: true },
            { uid: '3', name: '阿強', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=3', checkedIn: false },
            { uid: '4', name: '小美', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=4', checkedIn: false }
        ];
        
        Utils.$('registrationList').innerHTML = registrations.map(reg => `
            <div class="d-flex align-center gap-2 mb-2" style="padding:10px;background:var(--bg-tertiary);border-radius:10px">
                <img src="${reg.avatar}" alt="${reg.name}" style="width:36px;height:36px;border-radius:50%">
                <span style="flex:1">${reg.name}</span>
                ${reg.checkedIn 
                    ? '<span class="badge badge-primary">✓ 已報到</span>' 
                    : `<button class="btn btn-sm btn-outline" onclick="App.manualCheckIn('${reg.uid}')">手動報到</button>`}
            </div>`).join('');
    },
    
    updateProfilePage() {
        if (!currentUser) return;
        Utils.$('profileAvatar').src = currentUser.avatar;
        Utils.$('profileName').textContent = currentUser.lineNickname;
        Utils.$('profileRole').textContent = Utils.getRoleText(currentUser.role);
        Utils.$('profileRole').className = `role-badge role-${currentUser.role}`;
        Utils.$('profileGlory').textContent = `🏆 ${currentUser.gloryTag}`;
        Utils.$('profileCompleted').textContent = currentUser.completedCount;
        Utils.$('profileCanceled').textContent = currentUser.canceledCount;
        Utils.$('profilePoints').textContent = currentUser.points;
        Utils.$('profileUID').value = currentUser.uid;
        Utils.$('profileLineNickname').value = currentUser.lineNickname;
        Utils.$('profileGender').value = currentUser.gender || '';
        Utils.$('profileAge').value = currentUser.age || '';
        Utils.$('profileContact').value = currentUser.contact || '';
        Utils.$('profileFoot').value = currentUser.preferredFoot || '';
        Utils.$('profileCoins').textContent = currentUser.coins;
        Utils.$$('input[name="position"]').forEach(cb => {
            cb.checked = currentUser.positions && currentUser.positions.includes(cb.value);
        });
    },
    
    initCharts() {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const textColor = isDark ? '#a8c8a8' : '#4a5e4a';
        
        Object.values(charts).forEach(chart => chart && chart.destroy());
        charts = {};
        
        // 性別分佈
        const genderCtx = Utils.$('genderChart')?.getContext('2d');
        if (genderCtx) {
            charts.gender = new Chart(genderCtx, {
                type: 'doughnut',
                data: { labels: ['男', '女', '其他'], datasets: [{ data: [180, 65, 11], backgroundColor: ['#3b82f6', '#ec4899', '#a855f7'], borderWidth: 0 }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: textColor } } } }
            });
        }
        
        // 年齡區間
        const ageCtx = Utils.$('ageChart')?.getContext('2d');
        if (ageCtx) {
            charts.age = new Chart(ageCtx, {
                type: 'bar',
                data: { labels: ['18-24', '25-30', '31-35', '36-40', '41+'], datasets: [{ label: '人數', data: [45, 98, 72, 28, 13], backgroundColor: '#2d8a4e', borderRadius: 8 }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: textColor }, grid: { display: false } }, y: { ticks: { color: textColor }, grid: { color: isDark ? '#2a3a30' : '#e0e0e0' } } } }
            });
        }
        
        // 慣用腳
        const footCtx = Utils.$('footChart')?.getContext('2d');
        if (footCtx) {
            charts.foot = new Chart(footCtx, {
                type: 'pie',
                data: { labels: ['右腳', '左腳', '雙腳'], datasets: [{ data: [185, 48, 23], backgroundColor: ['#45b369', '#d4a534', '#6366f1'], borderWidth: 0 }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: textColor } } } }
            });
        }
        
        // 熱門位置
        const positionCtx = Utils.$('positionChart')?.getContext('2d');
        if (positionCtx) {
            charts.position = new Chart(positionCtx, {
                type: 'bar',
                data: { labels: ['ST', 'CM', 'CB', 'GK', 'LW', 'RW', 'CAM', 'CDM'], datasets: [{ label: '人數', data: [85, 72, 68, 45, 52, 48, 38, 32], backgroundColor: '#d4a534', borderRadius: 8 }] },
                options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: textColor }, grid: { color: isDark ? '#2a3a30' : '#e0e0e0' } }, y: { ticks: { color: textColor }, grid: { display: false } } } }
            });
        }
    },
    
    loadAdminData() {
        Utils.$('adminTotalUsers').textContent = '256';
        Utils.$('adminTotalEvents').textContent = '48';
        Utils.$('adminTotalCheckIns').textContent = '1,842';
        Utils.$('adminTotalRevenue').textContent = '$368,400';
        
        // 活動表格
        const eventTbody = document.querySelector('#adminEventTable tbody');
        if (eventTbody) {
            eventTbody.innerHTML = DEMO_EVENTS.map(event => `
                <tr>
                    <td><strong>${event.name}</strong></td>
                    <td>${event.date} ${event.time}</td>
                    <td>${event.location}</td>
                    <td>${event.registrations}/${event.capacity}</td>
                    <td><label class="toggle-switch"><input type="checkbox" ${event.isOpen ? 'checked' : ''} onchange="App.toggleEventStatus('${event.id}',this.checked)"><span class="toggle-slider"></span></label></td>
                    <td><button class="btn btn-sm btn-secondary" onclick="App.editEvent('${event.id}')">編輯</button> <button class="btn btn-sm btn-danger" onclick="App.deleteEvent('${event.id}')">刪除</button></td>
                </tr>`).join('');
        }
        
        // 用戶表格
        const userTbody = document.querySelector('#adminUserTable tbody');
        if (userTbody) {
            const users = [
                { id: '1', name: '足球王子', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=prince', role: 'veteran', completed: 45, canceled: 2, points: 580 },
                { id: '2', name: '閃電俠', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=flash', role: 'veteran', completed: 38, canceled: 1, points: 520 },
                { id: '3', name: '新手小明', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=ming', role: 'rookie', completed: 5, canceled: 0, points: 50 }
            ];
            userTbody.innerHTML = users.map(user => `
                <tr>
                    <td><img src="${user.avatar}" style="width:36px;height:36px;border-radius:50%"></td>
                    <td>${user.name}</td>
                    <td><span class="role-badge role-${user.role}">${Utils.getRoleText(user.role)}</span></td>
                    <td>${user.completed}/${user.canceled}</td>
                    <td>${user.points}</td>
                    <td><button class="btn btn-sm btn-secondary" onclick="App.openUserRoleModal('${user.id}','${user.name}','${user.role}')">權限</button></td>
                </tr>`).join('');
        }
    }
};

// ==========================================
// [區塊6] 主應用程式控制器
// ==========================================
const App = {
    async init() {
        this.initTheme();
        await Data.init();
        await Data.initLiff();
        this.loadInitialData();
        this.bindEvents();
        setTimeout(() => Utils.$('loadingOverlay').classList.add('hidden'), 500);
    },
    
    // 主題相關
    initTheme() {
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
        Utils.$('themeIcon').textContent = savedTheme === 'dark' ? '☀️' : '🌙';
    },
    
    toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        Utils.$('themeIcon').textContent = newTheme === 'dark' ? '☀️' : '🌙';
        if (Utils.$('page-stats').classList.contains('active')) UI.initCharts();
    },
    
    // 導航相關
    navigateTo(page) {
        Utils.$$('.page').forEach(p => p.classList.remove('active'));
        Utils.$(`page-${page}`).classList.add('active');
        Utils.$$('.nav-link').forEach(link => link.classList.toggle('active', link.dataset.page === page));
        Utils.$('navMenu').classList.remove('active');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        
        if (page === 'leaderboard') UI.renderLeaderboard(Data.getLeaderboard());
        else if (page === 'stats') UI.initCharts();
        else if (page === 'admin') UI.loadAdminData();
    },
    
    toggleMobileMenu() {
        Utils.$('navMenu').classList.toggle('active');
    },
    
    // 登入相關
    handleLogin() {
        if (CONFIG.liffId === "YOUR_LIFF_ID") {
            Utils.showToast('Demo 模式：模擬登入成功', 'info');
            this.simulateDemoLogin();
            return;
        }
        if (!liff.isLoggedIn()) liff.login();
    },
    
    async handleLineProfile() {
        try {
            const profile = await liff.getProfile();
            currentUser = {
                uid: profile.userId,
                lineNickname: profile.displayName,
                avatar: profile.pictureUrl || 'https://via.placeholder.com/100',
                role: 'rookie',
                gender: '', age: null, contact: '', preferredFoot: '', positions: [],
                completedCount: 0, canceledCount: 0, registrationCount: 0,
                gloryTag: '新星球員', points: 0, coins: 0,
                createdAt: new Date().toISOString()
            };
            await Data.syncUser();
            this.updateUIForLoggedInUser();
        } catch (error) {
            console.error('取得 LINE Profile 失敗:', error);
        }
    },
    
    simulateDemoLogin() {
        currentUser = {
            uid: 'demo_user_' + Date.now(),
            lineNickname: 'Demo 用戶',
            avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + Date.now(),
            role: 'admin',
            gender: 'male', age: 25, contact: 'demo@example.com',
            preferredFoot: 'right', positions: ['CM', 'CAM'],
            completedCount: 15, canceledCount: 2, registrationCount: 20,
            gloryTag: '場上指揮官', points: 180, coins: 50,
            createdAt: new Date().toISOString()
        };
        this.updateUIForLoggedInUser();
    },
    
    updateUIForLoggedInUser() {
        Utils.$('loginBtn').classList.add('hidden');
        Utils.$('userMenu').classList.remove('hidden');
        Utils.$('userAvatar').src = currentUser.avatar;
        Utils.$('heroCTA').textContent = '查看活動';
        Utils.$('heroCTA').onclick = () => this.navigateTo('events');
        Utils.$$('.admin-only').forEach(el => el.classList.toggle('hidden', currentUser.role !== 'admin'));
        UI.updateProfilePage();
    },
    
    // 資料載入
    loadInitialData() {
        Utils.animateNumber('statTotalUsers', 256);
        Utils.animateNumber('statTotalEvents', 48);
        Utils.animateNumber('statTotalGames', 312);
        UI.renderEvents(Data.getEvents(), 'homeEventGrid', 3);
        UI.renderEvents(Data.getEvents(), 'eventGrid');
    },
    
    // 活動相關
    openEventDetail(eventId) {
        currentEventId = eventId;
        const event = DEMO_EVENTS.find(e => e.id === eventId) || DEMO_EVENTS[0];
        
        Utils.$('eventDetailTitle').textContent = event.name;
        Utils.$('eventDetailContent').innerHTML = `
            <img src="${event.banner}" alt="${event.name}" style="width:100%;border-radius:12px;margin-bottom:20px">
            <div class="event-meta mb-3">
                <div class="event-meta-item"><span class="icon">📅</span><span>${event.date} ${event.time}</span></div>
                <div class="event-meta-item"><span class="icon">📍</span><span>${event.location}</span></div>
                <div class="event-meta-item"><span class="icon">💵</span><span>NT$ ${event.price}</span></div>
                <div class="event-meta-item"><span class="icon">👥</span><span>${event.registrations} / ${event.capacity} 人</span></div>
            </div>
            <p style="white-space:pre-line">${event.description}</p>`;
        
        this.generateQRCode(eventId);
        UI.renderRegistrationList();
        this.openModal('eventDetailModal');
    },
    
    generateQRCode(eventId) {
        const qrContainer = Utils.$('qrCodeDisplay');
        qrContainer.innerHTML = '';
        const checkInUrl = `${window.location.origin}${window.location.pathname}?checkin=${eventId}`;
        
        if (typeof QRCode !== 'undefined') {
            QRCode.toCanvas(document.createElement('canvas'), checkInUrl, {
                width: 200, margin: 0,
                color: { dark: '#1a2e1a', light: '#ffffff' }
            }, (error, canvas) => {
                if (!error) qrContainer.appendChild(canvas);
            });
        }
    },
    
    handleEventRegister() {
        if (!currentUser) { Utils.showToast('請先登入', 'warning'); this.handleLogin(); return; }
        Utils.showToast('報名成功！', 'success');
        this.closeModal('eventDetailModal');
    },
    
    handleQuickRegister(eventId) {
        if (!currentUser) { Utils.showToast('請先登入', 'warning'); this.handleLogin(); return; }
        Utils.showToast('報名成功！', 'success');
    },
    
    manualCheckIn(uid) {
        Utils.showToast('用戶報到成功', 'success');
        UI.renderRegistrationList();
    },
    
    filterEvents() { Utils.showToast('篩選功能已套用', 'info'); },
    resetFilters() { Utils.$('filterStatus').value = 'all'; Utils.$('filterDate').value = ''; this.loadInitialData(); Utils.showToast('篩選已重置', 'info'); },
    
    // 排行榜
    switchLeaderboard(period, btn) {
        Utils.$$('.leaderboard-tab').forEach(tab => tab.classList.remove('active'));
        btn.classList.add('active');
        UI.renderLeaderboard(Data.getLeaderboard());
    },
    
    // 管理員功能
    openEventModal(eventId = null) {
        Utils.$('eventFormTitle').textContent = eventId ? '編輯活動' : '建立新活動';
        Utils.$('eventForm').reset();
        Utils.$('eventId').value = eventId || '';
        Utils.$('bannerPreview').innerHTML = '';
        this.openModal('eventFormModal');
    },
    
    async saveEvent() {
        Utils.showToast('活動已儲存', 'success');
        this.closeModal('eventFormModal');
        UI.loadAdminData();
    },
    
    editEvent(eventId) { this.openEventModal(eventId); },
    deleteEvent(eventId) { if (confirm('確定要刪除此活動嗎？')) { Utils.showToast('活動已刪除', 'success'); UI.loadAdminData(); } },
    toggleEventStatus(eventId, isOpen) { Utils.showToast(`活動已${isOpen ? '開啟' : '關閉'}`, 'info'); },
    
    openUserRoleModal(userId, userName, currentRole) {
        Utils.$('editUserId').value = userId;
        Utils.$('editUserName').value = userName;
        Utils.$('editUserRole').value = currentRole;
        this.openModal('userRoleModal');
    },
    
    saveUserRole() {
        Utils.showToast('用戶角色已更新', 'success');
        this.closeModal('userRoleModal');
        UI.loadAdminData();
    },
    
    savePointsFormula() {
        const formula = {
            complete: parseInt(Utils.$('pointsComplete').value),
            cancel: parseInt(Utils.$('pointsCancel').value),
            onTime: parseInt(Utils.$('pointsOnTime').value),
            min: 0
        };
        localStorage.setItem('pointsFormula', JSON.stringify(formula));
        Utils.showToast('積分公式已儲存', 'success');
    },
    
    // Modal 控制
    openModal(modalId) {
        Utils.$(modalId).classList.add('active');
        document.body.style.overflow = 'hidden';
    },
    
    closeModal(modalId) {
        Utils.$(modalId).classList.remove('active');
        document.body.style.overflow = '';
    },
    
    // 分享功能
    shareToLine() {
        const url = encodeURIComponent(window.location.href);
        const text = encodeURIComponent('來看看我的足球數據！');
        window.open(`https://social-plugins.line.me/lineit/share?url=${url}&text=${text}`, '_blank');
    },
    
    shareToFacebook() {
        const url = encodeURIComponent(window.location.href);
        window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, '_blank');
    },
    
    shareToTwitter() {
        const url = encodeURIComponent(window.location.href);
        const text = encodeURIComponent('來看看我的足球數據！⚽');
        window.open(`https://twitter.com/intent/tweet?url=${url}&text=${text}`, '_blank');
    },
    
    copyShareLink() {
        navigator.clipboard.writeText(window.location.href).then(() => Utils.showToast('連結已複製', 'success'));
    },
    
    // 事件綁定
    bindEvents() {
        // 個人資料表單
        Utils.$('profileForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!currentUser) return;
            currentUser.gender = Utils.$('profileGender').value;
            currentUser.age = parseInt(Utils.$('profileAge').value) || null;
            currentUser.contact = Utils.$('profileContact').value;
            currentUser.preferredFoot = Utils.$('profileFoot').value;
            currentUser.positions = Array.from(Utils.$$('input[name="position"]:checked')).map(cb => cb.value);
            await Data.saveUser();
            Utils.showToast('資料已儲存', 'success');
        });
        
        // Banner 預覽
        Utils.$('eventBanner')?.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => { Utils.$('bannerPreview').innerHTML = `<img src="${e.target.result}" style="max-width:100%;max-height:150px;border-radius:8px;margin-top:10px">`; };
                reader.readAsDataURL(file);
            }
        });
        
        // Modal 點擊外部關閉
        Utils.$$('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    overlay.classList.remove('active');
                    document.body.style.overflow = '';
                }
            });
        });
        
        // URL 參數處理（QR Code 報到）
        const params = new URLSearchParams(window.location.search);
        const checkinEvent = params.get('checkin');
        if (checkinEvent) {
            setTimeout(() => {
                if (currentUser) Utils.showToast('報到成功！', 'success');
                else { Utils.showToast('請先登入後再報到', 'warning'); this.handleLogin(); }
            }, 1000);
        }
    }
};

// ==========================================
// [區塊7] 初始化
// ==========================================
document.addEventListener('DOMContentLoaded', () => App.init());
