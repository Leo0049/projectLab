/**
 * 票夾側邊欄模組
 *
 * 票券來源為 localStorage 的訂票紀錄（DataAPI 管理），只顯示目前登入者的票。
 * 每個座位視為一張獨立票券：未使用 → 使用中（1 分鐘倒數）→ 歷史票券。
 */

const TICKET_EXPIRY_MS = 60 * 1000;   // 「使用中」多久後自動歸檔
const WALLET_REFRESH_MS = 5000;       // 有票券倒數時的畫面刷新間隔

const WalletSidebar = {
    isOpen: false,
    refreshTimer: null,

    init() {
        this.renderSidebar();
        this.bindEvents();
    },

    // 渲染側邊欄
    renderSidebar() {
        if (document.getElementById('walletSidebar')) return;

        const sidebarHTML = `
        <!-- 票夾側邊欄遮罩 -->
        <div class="wallet-overlay" id="walletOverlay"></div>

        <!-- 票夾側邊欄 -->
        <div class="wallet-sidebar" id="walletSidebar">
            <div class="wallet-sidebar-header">
                <h5 class="mb-0">我的票夾</h5>
                <button type="button" class="btn-close" id="wallet-close-btn" aria-label="Close"></button>
            </div>
            <div class="wallet-sidebar-body">
                <!-- Tabs -->
                <ul class="nav nav-pills nav-fill mb-3" id="walletTabs" role="tablist">
                    <li class="nav-item" role="presentation">
                        <button class="nav-link active" id="wallet-unused-tab" data-bs-toggle="pill"
                            data-bs-target="#wallet-unused" type="button" role="tab">未使用</button>
                    </li>
                    <li class="nav-item" role="presentation">
                        <button class="nav-link" id="wallet-history-tab" data-bs-toggle="pill"
                            data-bs-target="#wallet-history" type="button" role="tab">歷史票券</button>
                    </li>
                </ul>

                <!-- Tab Content -->
                <div class="tab-content" id="walletTabsContent">
                    <div class="tab-pane fade show active" id="wallet-unused" role="tabpanel">
                        <div id="unused-tickets-list"></div>
                    </div>
                    <div class="tab-pane fade" id="wallet-history" role="tabpanel">
                        <div id="history-tickets-list"></div>
                    </div>
                </div>
            </div>
        </div>
        `;

        document.body.insertAdjacentHTML('beforeend', sidebarHTML);
    },

    bindEvents() {
        // 開啟票夾（導覽列按鈕由 auth.js 動態產生，因此用事件委派）
        document.addEventListener('click', (e) => {
            if (e.target.id === 'wallet-toggle-btn' || e.target.closest('#wallet-toggle-btn')) {
                e.preventDefault();
                this.toggle();
            }
        });

        const closeBtn = document.getElementById('wallet-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.close());
        }

        const overlay = document.getElementById('walletOverlay');
        if (overlay) {
            overlay.addEventListener('click', () => this.close());
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.close();
            }
        });

        // 「立即使用」按鈕（票券為動態產生，同樣用事件委派）
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('.use-ticket-btn');
            if (btn) {
                e.preventDefault();
                this.useSingleTicket(btn.dataset.ticketId);
            }
        });
    },

    open() {
        const sidebar = document.getElementById('walletSidebar');
        const overlay = document.getElementById('walletOverlay');
        if (!sidebar || !overlay) return;

        sidebar.classList.add('open');
        overlay.classList.add('open');
        document.body.style.overflow = 'hidden';
        this.isOpen = true;
        this.loadTickets();
    },

    close() {
        const sidebar = document.getElementById('walletSidebar');
        const overlay = document.getElementById('walletOverlay');
        if (!sidebar || !overlay) return;

        sidebar.classList.remove('open');
        overlay.classList.remove('open');
        document.body.style.overflow = '';
        this.isOpen = false;
        this.stopAutoRefresh();
    },

    toggle() {
        this.isOpen ? this.close() : this.open();
    },

    /* -------------------------------------------------------------- *
     * 資料存取
     * -------------------------------------------------------------- */

    getCurrentUserId() {
        return (typeof AuthManager !== 'undefined' && AuthManager.isLoggedIn())
            ? AuthManager.getUser().id
            : null;
    },

    readBookings() {
        return DataAPI.read(DataAPI.STORAGE_KEYS.BOOKINGS);
    },

    writeBookings(bookings) {
        DataAPI.write(DataAPI.STORAGE_KEYS.BOOKINGS, bookings);
    },

    readUsedTickets() {
        return DataAPI.read(DataAPI.STORAGE_KEYS.USED_TICKETS);
    },

    writeUsedTickets(tickets) {
        DataAPI.write(DataAPI.STORAGE_KEYS.USED_TICKETS, tickets);
    },

    /* -------------------------------------------------------------- *
     * 票券流程
     * -------------------------------------------------------------- */

    loadTickets() {
        this.checkExpiredTickets();
        this.loadUnusedTickets();
        this.loadHistoryTickets();
    },

    /**
     * 把「使用中」超過 TICKET_EXPIRY_MS 的座位歸檔到歷史票券
     */
    checkExpiredTickets() {
        const bookings = this.readBookings();
        const usedTickets = this.readUsedTickets();
        const now = Date.now();
        let hasChanges = false;

        bookings.forEach(booking => {
            if (!booking.seatStatuses || !booking.seatUsedAt) return;

            booking.seatStatuses.forEach((status, seatIndex) => {
                if (status !== 'using' || !booking.seatUsedAt[seatIndex]) return;
                if (now - booking.seatUsedAt[seatIndex] < TICKET_EXPIRY_MS) return;

                booking.seatStatuses[seatIndex] = 'used';

                usedTickets.push({
                    id: booking.id,
                    userId: booking.userId ?? null,
                    movieTitle: booking.movieTitle,
                    moviePoster: booking.moviePoster,
                    date: booking.date,
                    time: booking.time,
                    theaterName: booking.theaterName,
                    seat: booking.seats[seatIndex],
                    seatLabel: DataAPI.formatSeatLabel(booking.seats[seatIndex]),
                    seatIndex: seatIndex,
                    usedDate: new Date(booking.seatUsedAt[seatIndex]).toLocaleString('zh-TW'),
                    uniqueId: `${booking.id}-${seatIndex}`
                });

                hasChanges = true;
            });
        });

        if (hasChanges) {
            this.writeBookings(bookings);
            this.writeUsedTickets(usedTickets);
        }
    },

    /**
     * 把訂單展開成一張張座位票券（只取目前登入者的）
     * @returns {Array}
     */
    expandMyTickets() {
        const userId = this.getCurrentUserId();
        if (userId === null) return [];

        const tickets = [];

        this.readBookings()
            .filter(booking => booking.userId === userId)
            .forEach(booking => {
                if (!booking.seats || booking.seats.length === 0) return;

                booking.seats.forEach((seat, seatIndex) => {
                    const seatStatus = booking.seatStatuses ? booking.seatStatuses[seatIndex] : 'unused';
                    if (seatStatus !== 'unused' && seatStatus !== 'using') return;

                    tickets.push({
                        id: booking.id,
                        movieTitle: booking.movieTitle,
                        moviePoster: booking.moviePoster,
                        date: booking.date,
                        time: booking.time,
                        theaterName: booking.theaterName,
                        seatLabel: DataAPI.formatSeatLabel(seat),
                        ticketIndex: seatIndex,
                        uniqueId: `${booking.id}-${seatIndex}`,
                        seatStatus: seatStatus,
                        seatUsedAt: booking.seatUsedAt ? booking.seatUsedAt[seatIndex] : null
                    });
                });
            });

        return tickets;
    },

    loadUnusedTickets() {
        const container = document.getElementById('unused-tickets-list');
        if (!container) return;

        if (this.getCurrentUserId() === null) {
            container.innerHTML = `
                <div class="text-center text-muted py-5">
                    <p class="mt-3">請先登入才能查看票夾</p>
                </div>
            `;
            return;
        }

        const tickets = this.expandMyTickets();
        const usingTickets = tickets.filter(t => t.seatStatus === 'using');
        const unusedTickets = tickets.filter(t => t.seatStatus === 'unused');

        if (tickets.length === 0) {
            container.innerHTML = `
                <div class="text-center text-muted py-5">
                    <p class="mt-3">暫無未使用的票券</p>
                    <a href="booking.html" class="btn btn-primary btn-sm">立即訂票</a>
                </div>
            `;
            this.stopAutoRefresh();
            return;
        }

        let html = '';

        // 使用中的票券（倒數中）- 顯示 QR Code
        usingTickets.forEach(ticket => {
            const usedAt = ticket.seatUsedAt || Date.now();
            const remaining = Math.max(0, Math.ceil((TICKET_EXPIRY_MS - (Date.now() - usedAt)) / 1000));
            html += `
                <div class="ticket-card ticket-card-realistic mb-3 using" data-ticket-id="${escapeHtml(ticket.uniqueId)}">
                    <div class="ticket-card-header">
                        <span class="badge bg-warning text-dark">使用中</span>
                        <small class="text-muted">#${ticket.id}-${ticket.ticketIndex + 1}</small>
                    </div>
                    <div class="ticket-card-body">
                        <div class="ticket-using-content">
                            <div class="ticket-using-info">
                                ${ticket.moviePoster ? `<img src="${escapeHtml(ticket.moviePoster)}" class="single-ticket-poster" alt="">` : ''}
                                <div class="single-ticket-info">
                                    <h6 class="mb-1">${escapeHtml(ticket.movieTitle || '電影票')}</h6>
                                    <p class="mb-0 small"><strong>座位：</strong><span class="badge bg-primary">${escapeHtml(ticket.seatLabel)}</span></p>
                                    <p class="mb-0 small text-muted">${escapeHtml(ticket.date || '')} ${escapeHtml(ticket.time || '')}</p>
                                    <p class="mb-0 small text-muted">${escapeHtml(ticket.theaterName || '')}</p>
                                </div>
                            </div>
                            <div class="ticket-qr-section">
                                <canvas id="qrCanvas-${escapeHtml(ticket.uniqueId)}" class="ticket-qr-canvas" width="120" height="120"></canvas>
                                <div class="ticket-countdown">
                                    <span class="countdown-number">${remaining}</span>
                                    <span class="countdown-label">秒後過期</span>
                                </div>
                            </div>
                        </div>
                        <p class="mb-0 mt-2 small text-center text-warning-emphasis">請出示此 QR Code 給工作人員掃描</p>
                    </div>
                </div>
            `;
        });

        // 未使用票券
        unusedTickets.forEach(ticket => {
            html += `
                <div class="ticket-card ticket-card-realistic mb-3" data-ticket-id="${escapeHtml(ticket.uniqueId)}">
                    <div class="ticket-card-header">
                        <span class="badge bg-success">未使用</span>
                        <small class="text-muted">#${ticket.id}-${ticket.ticketIndex + 1}</small>
                    </div>
                    <div class="ticket-card-body">
                        <div class="single-ticket">
                            ${ticket.moviePoster ? `<img src="${escapeHtml(ticket.moviePoster)}" class="single-ticket-poster" alt="">` : ''}
                            <div class="single-ticket-info">
                                <h6 class="mb-1">${escapeHtml(ticket.movieTitle || '電影票')}</h6>
                                <p class="mb-0 small"><strong>座位：</strong><span class="badge bg-primary">${escapeHtml(ticket.seatLabel)}</span></p>
                                <p class="mb-0 small text-muted">${escapeHtml(ticket.date || '')} ${escapeHtml(ticket.time || '')}</p>
                                <p class="mb-0 small text-muted">${escapeHtml(ticket.theaterName || '')}</p>
                            </div>
                        </div>
                    </div>
                    <div class="ticket-card-footer d-flex justify-content-center">
                        <button type="button" class="btn btn-sm btn-primary w-50 use-ticket-btn"
                                data-ticket-id="${escapeHtml(ticket.uniqueId)}">
                            立即使用
                        </button>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;

        // 為使用中的票券繪製 QR Code
        usingTickets.forEach(ticket => {
            const canvas = document.getElementById(`qrCanvas-${ticket.uniqueId}`);
            if (canvas) {
                this.drawQRCode(canvas.getContext('2d'), ticket.uniqueId, 120, 120);
            }
        });

        // 有倒數中的票券才需要定時刷新
        if (usingTickets.length > 0) {
            this.startAutoRefresh();
        } else {
            this.stopAutoRefresh();
        }
    },

    /**
     * 將指定座位標記為使用中，開始倒數
     * @param {string} uniqueId - `${bookingId}-${seatIndex}`
     */
    useSingleTicket(uniqueId) {
        const separator = uniqueId.lastIndexOf('-');
        const bookingId = parseInt(uniqueId.slice(0, separator));
        const seatIndex = parseInt(uniqueId.slice(separator + 1));

        const bookings = this.readBookings();
        const booking = bookings.find(b => b.id === bookingId);
        if (!booking) return;

        if (!booking.seatStatuses) {
            booking.seatStatuses = booking.seats.map(() => 'unused');
        }
        if (!booking.seatUsedAt) {
            booking.seatUsedAt = booking.seats.map(() => null);
        }

        booking.seatStatuses[seatIndex] = 'using';
        booking.seatUsedAt[seatIndex] = Date.now();
        this.writeBookings(bookings);

        if (typeof AuthManager !== 'undefined') {
            const seatLabel = DataAPI.formatSeatLabel(booking.seats[seatIndex]);
            AuthManager.showToast(`座位 ${seatLabel} 已開始使用，約 1 分鐘後將移至歷史票券`, 'info');
        }

        this.loadTickets();
    },

    loadHistoryTickets() {
        const container = document.getElementById('history-tickets-list');
        if (!container) return;

        const userId = this.getCurrentUserId();
        const historyTickets = userId === null
            ? []
            : this.readUsedTickets().filter(t => t.userId === userId);

        if (historyTickets.length === 0) {
            container.innerHTML = `
                <div class="text-center text-muted py-5">
                    <p class="mt-3">暫無歷史票券</p>
                </div>
            `;
            return;
        }

        container.innerHTML = historyTickets.map(ticket => `
            <div class="ticket-card ticket-card-realistic mb-3 used">
                <div class="ticket-card-header">
                    <span class="badge bg-secondary">已使用</span>
                    <small class="text-muted">${escapeHtml(ticket.usedDate || '')}</small>
                </div>
                <div class="ticket-card-body">
                    <div class="single-ticket">
                        ${ticket.moviePoster ? `<img src="${escapeHtml(ticket.moviePoster)}" class="single-ticket-poster" style="opacity: 0.6;" alt="">` : ''}
                        <div class="single-ticket-info">
                            <h6 class="mb-1 text-muted">${escapeHtml(ticket.movieTitle || '電影票')}</h6>
                            <p class="mb-0 small text-muted"><strong>座位：</strong><span class="badge bg-secondary">${escapeHtml(ticket.seatLabel)}</span></p>
                            ${ticket.date ? `<p class="mb-0 small text-muted">${escapeHtml(ticket.date)} ${escapeHtml(ticket.time || '')}</p>` : ''}
                            ${ticket.theaterName ? `<p class="mb-0 small text-muted">${escapeHtml(ticket.theaterName)}</p>` : ''}
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
    },

    /* -------------------------------------------------------------- *
     * 倒數刷新
     * -------------------------------------------------------------- */

    startAutoRefresh() {
        this.stopAutoRefresh();
        this.refreshTimer = setInterval(() => {
            if (this.isOpen) {
                this.loadTickets();
            } else {
                this.stopAutoRefresh();
            }
        }, WALLET_REFRESH_MS);
    },

    stopAutoRefresh() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
    },

    /* -------------------------------------------------------------- *
     * QR Code（示意用途，非真正的 QR 編碼）
     * -------------------------------------------------------------- */

    drawQRCode(ctx, data, width, height) {
        const size = 9; // 模組數量
        const moduleSize = Math.floor(Math.min(width, height) / (size + 2));
        const offset = (width - moduleSize * size) / 2;

        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, width, height);

        const hash = this.simpleHash(data);
        ctx.fillStyle = '#000';

        // 三個角落的定位圖案
        this.drawFinderPattern(ctx, offset, offset, moduleSize);
        this.drawFinderPattern(ctx, offset + (size - 3) * moduleSize, offset, moduleSize);
        this.drawFinderPattern(ctx, offset, offset + (size - 3) * moduleSize, moduleSize);

        // 資料區域
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                if ((i < 3 && j < 3) || (i < 3 && j >= size - 3) || (i >= size - 3 && j < 3)) continue;
                if ((hash >> ((i * size + j) % 32)) & 1) {
                    ctx.fillRect(offset + j * moduleSize, offset + i * moduleSize, moduleSize - 1, moduleSize - 1);
                }
            }
        }
    },

    drawFinderPattern(ctx, x, y, moduleSize) {
        ctx.fillRect(x, y, moduleSize * 3, moduleSize * 3);
        ctx.fillStyle = '#fff';
        ctx.fillRect(x + moduleSize * 0.5, y + moduleSize * 0.5, moduleSize * 2, moduleSize * 2);
        ctx.fillStyle = '#000';
        ctx.fillRect(x + moduleSize, y + moduleSize, moduleSize, moduleSize);
    },

    simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash = hash & hash;
        }
        return Math.abs(hash);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    WalletSidebar.init();
});
