/**
 * 票夾側邊欄模組
 */

const WalletSidebar = {
    isOpen: false,

    // 初始化
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
                    <!-- 未使用票券 -->
                    <div class="tab-pane fade show active" id="wallet-unused" role="tabpanel">
                        <div id="unused-tickets-list">
                            <!-- 動態載入 -->
                        </div>
                    </div>
                    <!-- 歷史票券 -->
                    <div class="tab-pane fade" id="wallet-history" role="tabpanel">
                        <div id="history-tickets-list">
                            <!-- 動態載入 -->
                        </div>
                    </div>
                </div>
            </div>
        </div>
        `;

        document.body.insertAdjacentHTML('beforeend', sidebarHTML);
    },

    // 綁定事件
    bindEvents() {
        // 開啟票夾
        document.addEventListener('click', (e) => {
            if (e.target.id === 'wallet-toggle-btn' || e.target.closest('#wallet-toggle-btn')) {
                e.preventDefault();
                this.toggle();
            }
        });

        // 關閉按鈕
        const closeBtn = document.getElementById('wallet-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.close());
        }

        // 點擊遮罩關閉
        const overlay = document.getElementById('walletOverlay');
        if (overlay) {
            overlay.addEventListener('click', () => this.close());
        }

        // ESC 關閉
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.close();
            }
        });
    },

    // 開啟側邊欄
    open() {
        const sidebar = document.getElementById('walletSidebar');
        const overlay = document.getElementById('walletOverlay');

        if (sidebar && overlay) {
            sidebar.classList.add('open');
            overlay.classList.add('open');
            document.body.style.overflow = 'hidden';
            this.isOpen = true;
            this.loadTickets();
        }
    },

    // 關閉側邊欄
    close() {
        const sidebar = document.getElementById('walletSidebar');
        const overlay = document.getElementById('walletOverlay');

        if (sidebar && overlay) {
            sidebar.classList.remove('open');
            overlay.classList.remove('open');
            document.body.style.overflow = '';
            this.isOpen = false;
        }
    },

    // 切換側邊欄
    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    },

    // 載入票券
    loadTickets() {
        this.checkExpiredTickets(); // 先檢查過期票券
        this.loadUnusedTickets();
        this.loadHistoryTickets();
    },

    // 檢查並移動過期的座位票券（使用超過1分鐘）
    checkExpiredTickets() {
        const bookings = JSON.parse(localStorage.getItem('bookings') || '[]');
        const usedTickets = JSON.parse(localStorage.getItem('usedTickets') || '[]');
        const now = Date.now();
        const EXPIRY_TIME = 60 * 1000; // 1分鐘

        let hasChanges = false;

        bookings.forEach((booking, bookingIndex) => {
            if (!booking.seatStatuses || !booking.seatUsedAt) return;

            booking.seatStatuses.forEach((status, seatIndex) => {
                if (status === 'using' && booking.seatUsedAt[seatIndex]) {
                    const elapsed = now - booking.seatUsedAt[seatIndex];
                    if (elapsed >= EXPIRY_TIME) {
                        // 標記該座位為已使用
                        booking.seatStatuses[seatIndex] = 'used';

                        // 將該座位加入歷史票券
                        usedTickets.push({
                            id: booking.id,
                            movieTitle: booking.movieTitle,
                            moviePoster: booking.moviePoster,
                            date: booking.date,
                            time: booking.time,
                            theaterName: booking.theaterName,
                            seat: booking.seats[seatIndex],
                            seatLabel: `${String.fromCharCode(65 + booking.seats[seatIndex].row)}${booking.seats[seatIndex].col + 1}`,
                            seatIndex: seatIndex,
                            usedDate: new Date(booking.seatUsedAt[seatIndex]).toLocaleString('zh-TW'),
                            uniqueId: `${booking.id}-${seatIndex}`
                        });

                        hasChanges = true;
                    }
                }
            });
        });

        if (hasChanges) {
            localStorage.setItem('bookings', JSON.stringify(bookings));
            localStorage.setItem('usedTickets', JSON.stringify(usedTickets));
        }
    },

    // 載入未使用票券 - 每個座位顯示為獨立票券
    loadUnusedTickets() {
        const container = document.getElementById('unused-tickets-list');
        if (!container) return;

        const bookings = JSON.parse(localStorage.getItem('bookings') || '[]');

        // 展開所有票券（每個座位為一張票，根據 seatStatuses 判斷狀態）
        const expandedTickets = [];

        bookings.forEach(booking => {
            // 初始化 seatStatuses（如果不存在）
            if (!booking.seatStatuses && booking.seats) {
                booking.seatStatuses = booking.seats.map(() => 'unused');
            }

            if (booking.seats && booking.seats.length > 0) {
                booking.seats.forEach((seat, seatIndex) => {
                    const seatStatus = booking.seatStatuses ? booking.seatStatuses[seatIndex] : 'unused';
                    // 只顯示未使用和使用中的座位
                    if (seatStatus === 'unused' || seatStatus === 'using') {
                        expandedTickets.push({
                            ...booking,
                            singleSeat: seat,
                            seatLabel: `${String.fromCharCode(65 + seat.row)}${seat.col + 1}`,
                            ticketIndex: seatIndex,
                            uniqueId: `${booking.id}-${seatIndex}`,
                            seatStatus: seatStatus,
                            seatUsedAt: booking.seatUsedAt ? booking.seatUsedAt[seatIndex] : null
                        });
                    }
                });
            }
        });

        // 分離使用中和未使用的票券
        const unusedTickets = expandedTickets.filter(t => t.seatStatus === 'unused');
        const usingTickets = expandedTickets.filter(t => t.seatStatus === 'using');

        if (unusedTickets.length === 0 && usingTickets.length === 0) {
            container.innerHTML = `
                <div class="text-center text-muted py-5">
                    <p class="mt-3">暫無未使用的票券</p>
                    <a href="booking.html" class="btn btn-primary btn-sm">立即訂票</a>
                </div>
            `;
            return;
        }

        let html = '';

        // 使用中的票券（倒計時中）- 顯示 QR Code
        usingTickets.forEach(ticket => {
            const usedAt = ticket.seatUsedAt || Date.now();
            const remaining = Math.max(0, 60 - Math.floor((Date.now() - usedAt) / 1000));
            html += `
                <div class="ticket-card ticket-card-realistic mb-3 using" data-ticket-id="${ticket.uniqueId}">
                    <div class="ticket-card-header">
                        <span class="badge bg-warning text-dark">使用中</span>
                        <small class="text-muted">#${ticket.id}-${ticket.ticketIndex + 1}</small>
                    </div>
                    <div class="ticket-card-body">
                        <div class="ticket-using-content">
                            <div class="ticket-using-info">
                                ${ticket.moviePoster ? `<img src="${ticket.moviePoster}" class="single-ticket-poster" alt="">` : ''}
                                <div class="single-ticket-info">
                                    <h6 class="mb-1">${ticket.movieTitle || '電影票'}</h6>
                                    <p class="mb-0 small"><strong>座位：</strong><span class="badge bg-primary">${ticket.seatLabel}</span></p>
                                    <p class="mb-0 small text-white">${ticket.date || ''} ${ticket.time || ''}</p>
                                    <p class="mb-0 small text-white">${ticket.theaterName || ''}</p>
                                </div>
                            </div>
                            <div class="ticket-qr-section">
                                <canvas id="qrCanvas-${ticket.uniqueId}" class="ticket-qr-canvas" width="120" height="120"></canvas>
                                <div class="ticket-countdown">
                                    <span class="countdown-number">${remaining}</span>
                                    <span class="countdown-label">秒後過期</span>
                                </div>
                            </div>
                        </div>
                        <p class="mb-0 mt-2 small text-center text-warning">請出示此 QR Code 給工作人員掃描</p>
                    </div>
                </div>
            `;
        });
        // 未使用票券
        unusedTickets.forEach(ticket => {
            console.log(ticket);
            html += `
                <div class="ticket-card ticket-card-realistic mb-3" data-ticket-id="${ticket.uniqueId}">
                    <div class="ticket-card-header">
                        <span class="badge bg-success">未使用</span>
                        <small class="text-muted">#${ticket.id}-${ticket.ticketIndex + 1}</small>
                    </div>
                    <div class="ticket-card-body">
                        <div class="single-ticket">
                            <img src="${ticket.moviePoster}" class="single-ticket-poster" alt="">
                            <div class="single-ticket-info">
                                <h6 class="mb-1 text-black">${ticket.movieTitle || '電影票'}</h6>
                                <p class="mb-0 small text-black"><strong>座位：</strong><span class="badge bg-primary">${ticket.seatLabel}</span></p>
                                <p class="mb-0 small text-muted">${ticket.date} ${ticket.time || ''}</p>
                                <p class="mb-0 small text-muted">${ticket.theaterName}</p>
                            </div>
                        </div>
                    </div>
                    <div class="ticket-card-footer d-flex justify-content-center">
                        <button class="btn btn-sm btn-dark w-50 rounded" onclick="WalletSidebar.useSingleTicket('${ticket.uniqueId}')">
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
                const ctx = canvas.getContext('2d');
                this.drawQRCode(ctx, ticket.uniqueId, 120, 120);
            }
        });

        // 如果有使用中的票券，設定定時刷新
        if (usingTickets.length > 0) {
            setTimeout(() => {
                if (this.isOpen) {
                    this.loadTickets();
                }
            }, 5000); // 每5秒刷新一次
        }
    },

    // 使用單張票券 - 只標記特定座位
    useSingleTicket(uniqueId) {
        const [bookingId, seatIndex] = uniqueId.split('-').map((v, i) => i === 0 ? parseInt(v) : parseInt(v));
        const bookings = JSON.parse(localStorage.getItem('bookings') || '[]');
        const bookingIndex = bookings.findIndex(b => b.id === bookingId);

        if (bookingIndex !== -1) {
            const booking = bookings[bookingIndex];

            // 初始化 seatStatuses 和 seatUsedAt（如果不存在）
            if (!booking.seatStatuses) {
                booking.seatStatuses = booking.seats.map(() => 'unused');
            }
            if (!booking.seatUsedAt) {
                booking.seatUsedAt = booking.seats.map(() => null);
            }

            // 只標記該座位為使用中
            booking.seatStatuses[seatIndex] = 'using';
            booking.seatUsedAt[seatIndex] = Date.now();

            localStorage.setItem('bookings', JSON.stringify(bookings));

            if (typeof AuthManager !== 'undefined') {
                const seatLabel = `${String.fromCharCode(65 + booking.seats[seatIndex].row)}${booking.seats[seatIndex].col + 1}`;
                AuthManager.showToast(`座位 ${seatLabel} 已開始使用，約1分鐘後將移至歷史票券`, 'info');
            }

            // 添加使用動畫
            const ticketCard = document.querySelector(`[data-ticket-id="${uniqueId}"]`);
            if (ticketCard) {
                ticketCard.classList.add('ticket-using-animation');
            }

            this.loadTickets();
        }
    },

    // 顯示單張票券 QR Code - 使用 Canvas 繪製
    showSingleQRCode(uniqueId, seatLabel) {
        // 移除舊的 modal（如果存在）
        const existingModal = document.getElementById('qrModal');
        if (existingModal) existingModal.remove();

        // 創建 QR Code Modal
        const modalHTML = `
            <div class="qr-modal-overlay open" id="qrModal">
                <div class="qr-modal-content">
                    <h5 class="mb-3">票券 QR Code</h5>
                    <canvas id="qrCodeCanvas" class="qr-code-canvas" width="180" height="180"></canvas>
                    <p class="mt-3 mb-1"><strong>票券編號:</strong> ${uniqueId}</p>
                    <p class="mb-3"><strong>座位:</strong> <span class="badge bg-primary">${seatLabel}</span></p>
                    <p class="text-muted small mb-3">請出示此 QR Code 給工作人員掃描</p>
                    <button class="btn btn-primary btn-sm" onclick="document.getElementById('qrModal').remove()">關閉</button>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // 繪製 QR Code（簡化版，使用資料生成圖案）
        const canvas = document.getElementById('qrCodeCanvas');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            this.drawQRCode(ctx, uniqueId, 180, 180);
        }

        // 點擊背景關閉
        document.getElementById('qrModal').addEventListener('click', (e) => {
            if (e.target.id === 'qrModal') {
                e.target.remove();
            }
        });
    },

    // 繪製簡化的 QR Code 圖案
    drawQRCode(ctx, data, width, height) {
        const size = 9; // 模組數量
        const moduleSize = Math.floor(Math.min(width, height) / (size + 2));
        const offset = (width - moduleSize * size) / 2;

        // 白色背景
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, width, height);

        // 根據資料生成偽隨機圖案
        const hash = this.simpleHash(data);
        ctx.fillStyle = '#000';

        // 繪製定位圖案（三個角落的方塊）
        this.drawFinderPattern(ctx, offset, offset, moduleSize);
        this.drawFinderPattern(ctx, offset + (size - 3) * moduleSize, offset, moduleSize);
        this.drawFinderPattern(ctx, offset, offset + (size - 3) * moduleSize, moduleSize);

        // 繪製資料區域
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                // 跳過定位圖案區域
                if ((i < 3 && j < 3) || (i < 3 && j >= size - 3) || (i >= size - 3 && j < 3)) continue;

                // 根據 hash 決定是否填充
                if ((hash >> ((i * size + j) % 32)) & 1) {
                    ctx.fillRect(offset + j * moduleSize, offset + i * moduleSize, moduleSize - 1, moduleSize - 1);
                }
            }
        }
    },

    // 繪製定位圖案
    drawFinderPattern(ctx, x, y, moduleSize) {
        // 外框
        ctx.fillRect(x, y, moduleSize * 3, moduleSize * 3);
        // 白色中框
        ctx.fillStyle = '#fff';
        ctx.fillRect(x + moduleSize * 0.5, y + moduleSize * 0.5, moduleSize * 2, moduleSize * 2);
        // 黑色中心
        ctx.fillStyle = '#000';
        ctx.fillRect(x + moduleSize, y + moduleSize, moduleSize, moduleSize);
    },

    // 簡單的 hash 函數
    simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash);
    },

    // 使用票券
    useTicket(ticketId) {
        const bookings = JSON.parse(localStorage.getItem('bookings') || '[]');
        const ticketIndex = bookings.findIndex(b => b.id === ticketId);

        if (ticketIndex !== -1) {
            bookings[ticketIndex].status = 'Using';
            bookings[ticketIndex].usedAt = Date.now();
            localStorage.setItem('bookings', JSON.stringify(bookings));

            if (typeof AuthManager !== 'undefined') {
                AuthManager.showToast('票券已開始使用，約1分鐘後將移至歷史票券', 'info');
            }

            this.loadTickets();
        }
    },

    // 載入歷史票券 - 每個座位顯示為獨立票券
    loadHistoryTickets() {
        const container = document.getElementById('history-tickets-list');
        if (!container) return;

        const historyTickets = JSON.parse(localStorage.getItem('usedTickets') || '[]');

        if (historyTickets.length === 0) {
            container.innerHTML = `
                <div class="text-center text-muted py-5">
                    <p class="mt-3">暫無歷史票券</p>
                </div>
            `;
            return;
        }

        // 歷史票券已經是單獨座位形式，直接顯示
        container.innerHTML = historyTickets.map(ticket => `
            <div class="ticket-card ticket-card-realistic mb-3 used">
                <div class="ticket-card-header">
                    <span class="badge bg-secondary">已使用</span>
                    <small class="text-muted">${ticket.usedDate || ''}</small>
                </div>
                <div class="ticket-card-body">
                    <div class="single-ticket">
                        ${ticket.moviePoster ? `<img src="${ticket.moviePoster}" class="single-ticket-poster" style="opacity: 0.6;" alt="">` : ''}
                        <div class="single-ticket-info">
                            <h6 class="mb-1 text-muted">${ticket.movieTitle || '電影票'}</h6>
                            <p class="mb-0 small text-muted"><strong>座位：</strong><span class="badge bg-secondary">${ticket.seatLabel}</span></p>
                            ${ticket.date ? `<p class="mb-0 small text-muted">${ticket.date} ${ticket.time || ''}</p>` : ''}
                            ${ticket.theaterName ? `<p class="mb-0 small text-muted">${ticket.theaterName}</p>` : ''}
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
    },

    // 格式化座位
    formatSeats(seats) {
        if (!seats || seats.length === 0) return '未知';
        return seats.map(s => `${String.fromCharCode(65 + s.row)}${s.col + 1}`).join(', ');
    },

    // 顯示 QR Code
    showQRCode(ticketId) {
        alert(`票券 QR Code\n\n訂單編號: ${ticketId}\n\n請出示此 QR Code 給工作人員掃描`);
    }
};

// 頁面載入時初始化
document.addEventListener('DOMContentLoaded', () => {
    WalletSidebar.init();
});
