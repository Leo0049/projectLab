/**
 * 票夾側邊欄
 *
 * 票券資料全部來自 /api/tickets。每個座位是一張獨立票券，
 * 「使用中 → 歷史票券」的歸檔由伺服器判斷，前端只負責顯示倒數。
 */

const TICKET_EXPIRY_MS = 60 * 1000;   // 與伺服器的 TICKET_EXPIRY_MS 一致
const WALLET_REFRESH_MS = 5000;       // 有票券倒數時的刷新間隔

const WalletSidebar = {
    isOpen: false,
    refreshTimer: null,

    init() {
        this.renderSidebar();
        this.bindEvents();
    },

    renderSidebar() {
        if (document.getElementById('walletSidebar')) return;

        const sidebarHTML = `
        <div class="wallet-overlay" id="walletOverlay"></div>

        <div class="wallet-sidebar" id="walletSidebar">
            <div class="wallet-sidebar-header">
                <h5 class="mb-0">我的票夾</h5>
                <button type="button" class="btn-close" id="wallet-close-btn" aria-label="Close"></button>
            </div>
            <div class="wallet-sidebar-body">
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
        // 導覽列按鈕由 auth.js 動態產生，用事件委派
        document.addEventListener('click', (e) => {
            if (e.target.id === 'wallet-toggle-btn' || e.target.closest('#wallet-toggle-btn')) {
                e.preventDefault();
                this.toggle();
                return;
            }

            if (e.target.id === 'wallet-close-btn' || e.target.closest('#wallet-close-btn')) {
                this.close();
                return;
            }

            if (e.target.id === 'walletOverlay') {
                this.close();
                return;
            }

            const useBtn = e.target.closest('.use-ticket-btn');
            if (useBtn) {
                e.preventDefault();
                this.useSingleTicket(useBtn.dataset.ticketId, useBtn);
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) this.close();
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
     * 載入票券
     * -------------------------------------------------------------- */

    async loadTickets() {
        const unusedContainer = document.getElementById('unused-tickets-list');
        const historyContainer = document.getElementById('history-tickets-list');
        if (!unusedContainer || !historyContainer) return;

        if (!AuthManager.isLoggedIn()) {
            unusedContainer.innerHTML = this.emptyState('🎫', '請先登入才能查看票夾');
            historyContainer.innerHTML = this.emptyState('🎫', '請先登入才能查看票夾');
            this.stopAutoRefresh();
            return;
        }

        let tickets;
        try {
            tickets = await DataAPI.getTickets();
        } catch (error) {
            console.error('載入票券失敗:', error);
            unusedContainer.innerHTML = this.emptyState('⚠️', '無法載入票券，請稍後再試');
            return;
        }

        this.renderActiveTickets(tickets.active, unusedContainer);
        this.renderHistoryTickets(tickets.history, historyContainer);
    },

    emptyState(icon, message, action = '') {
        return `
            <div class="empty-state">
                <span class="empty-icon">${icon}</span>
                <p class="mb-1">${escapeHtml(message)}</p>
                ${action}
            </div>
        `;
    },

    renderActiveTickets(tickets, container) {
        if (tickets.length === 0) {
            container.innerHTML = this.emptyState(
                '🎫', '暫無未使用的票券',
                '<a href="booking.html" class="btn btn-primary btn-sm mt-2">立即訂票</a>'
            );
            this.stopAutoRefresh();
            return;
        }

        const usingTickets = tickets.filter(t => t.status === 'using');
        const unusedTickets = tickets.filter(t => t.status === 'unused');

        let html = '';

        // 使用中：顯示 QR Code 與倒數
        usingTickets.forEach(ticket => {
            const usedAt = ticket.usedAt || Date.now();
            const remaining = Math.max(0, Math.ceil((TICKET_EXPIRY_MS - (Date.now() - usedAt)) / 1000));
            html += `
                <div class="ticket-card ticket-card-realistic mb-3 using" data-ticket-id="${ticket.id}">
                    <div class="ticket-card-header">
                        <span class="badge bg-warning text-dark">使用中</span>
                        <small class="text-muted">#${ticket.bookingId}-${ticket.id}</small>
                    </div>
                    <div class="ticket-card-body">
                        <div class="ticket-using-content">
                            <div class="ticket-using-info">
                                ${this.posterTag(ticket)}
                                ${this.ticketInfo(ticket)}
                            </div>
                            <div class="ticket-qr-section">
                                <canvas id="qrCanvas-${ticket.id}" class="ticket-qr-canvas" width="120" height="120"></canvas>
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

        // 未使用
        unusedTickets.forEach(ticket => {
            html += `
                <div class="ticket-card ticket-card-realistic mb-3" data-ticket-id="${ticket.id}">
                    <div class="ticket-card-header">
                        <span class="badge bg-success">未使用</span>
                        <small class="text-muted">#${ticket.bookingId}-${ticket.id}</small>
                    </div>
                    <div class="ticket-card-body">
                        <div class="single-ticket">
                            ${this.posterTag(ticket)}
                            ${this.ticketInfo(ticket)}
                        </div>
                    </div>
                    <div class="ticket-card-footer d-flex justify-content-center">
                        <button type="button" class="btn btn-sm btn-primary w-50 use-ticket-btn"
                                data-ticket-id="${ticket.id}">
                            立即使用
                        </button>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;

        usingTickets.forEach(ticket => {
            const canvas = document.getElementById(`qrCanvas-${ticket.id}`);
            if (canvas) {
                this.drawQRCode(canvas.getContext('2d'), `FT-${ticket.bookingId}-${ticket.id}`, 120, 120);
            }
        });

        if (usingTickets.length > 0) {
            this.startAutoRefresh();
        } else {
            this.stopAutoRefresh();
        }
    },

    renderHistoryTickets(tickets, container) {
        if (tickets.length === 0) {
            container.innerHTML = this.emptyState('🗂️', '暫無歷史票券');
            return;
        }

        container.innerHTML = tickets.map(ticket => `
            <div class="ticket-card ticket-card-realistic mb-3 used">
                <div class="ticket-card-header">
                    <span class="badge bg-secondary">已使用</span>
                    <small class="text-muted">#${ticket.bookingId}-${ticket.id}</small>
                </div>
                <div class="ticket-card-body">
                    <div class="single-ticket">
                        ${this.posterTag(ticket, true)}
                        ${this.ticketInfo(ticket, true)}
                    </div>
                </div>
            </div>
        `).join('');
    },

    posterTag(ticket, dimmed = false) {
        if (!ticket.moviePoster) return '';
        const style = dimmed ? ' style="opacity: 0.6;"' : '';
        return `<img src="${escapeHtml(ticket.moviePoster)}" class="single-ticket-poster"${style} alt="">`;
    },

    ticketInfo(ticket, dimmed = false) {
        const titleClass = dimmed ? 'mb-1 text-muted' : 'mb-1';
        const badgeClass = dimmed ? 'bg-secondary' : 'bg-primary';
        return `
            <div class="single-ticket-info">
                <h6 class="${titleClass}">${escapeHtml(ticket.movieTitle || '電影票')}</h6>
                <p class="mb-0 small"><strong>座位：</strong><span class="badge ${badgeClass}">${escapeHtml(ticket.seatLabel)}</span></p>
                <p class="mb-0 small text-muted">${escapeHtml(ticket.date || '')} ${escapeHtml(ticket.time || '')}</p>
                <p class="mb-0 small text-muted">${escapeHtml(ticket.theaterName || '')}</p>
            </div>
        `;
    },

    /**
     * 進場：伺服器標記為使用中並開始計時
     */
    async useSingleTicket(ticketId, button) {
        if (button) button.disabled = true;

        try {
            const tickets = await DataAPI.useTicket(ticketId);
            AuthManager.showToast('票券已開始使用，約 1 分鐘後將移至歷史票券', 'info');

            const unusedContainer = document.getElementById('unused-tickets-list');
            const historyContainer = document.getElementById('history-tickets-list');
            if (unusedContainer) this.renderActiveTickets(tickets.active, unusedContainer);
            if (historyContainer) this.renderHistoryTickets(tickets.history, historyContainer);
        } catch (error) {
            AuthManager.showToast(error.message || '無法使用票券', 'danger');
            if (button) button.disabled = false;
        }
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
     * QR Code（示意圖案，非真正的 QR 編碼）
     * -------------------------------------------------------------- */

    drawQRCode(ctx, data, width, height) {
        const size = 9;
        const moduleSize = Math.floor(Math.min(width, height) / (size + 2));
        const offset = (width - moduleSize * size) / 2;

        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, width, height);

        const hash = this.simpleHash(data);
        ctx.fillStyle = '#000';

        this.drawFinderPattern(ctx, offset, offset, moduleSize);
        this.drawFinderPattern(ctx, offset + (size - 3) * moduleSize, offset, moduleSize);
        this.drawFinderPattern(ctx, offset, offset + (size - 3) * moduleSize, moduleSize);

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
