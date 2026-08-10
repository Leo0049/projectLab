/**
 * 管理後台
 *
 * 前端只是把 /api/admin/* 的資料畫出來；真正的權限判斷在伺服器，
 * 非管理員即使把這頁打開，每支 API 也都會回 403。
 */

document.addEventListener('DOMContentLoaded', async function () {
    await AuthManager.ready;

    const deniedBox = document.getElementById('admin-denied');
    const contentBox = document.getElementById('admin-content');

    if (!AuthManager.isLoggedIn() || AuthManager.getUser().role !== 'admin') {
        deniedBox.style.display = 'block';
        return;
    }

    contentBox.style.display = 'block';

    await Promise.all([loadStats(), setupShowtimePanel(), setupBookingPanel(), setupUserPanel()]);
});

/* ------------------------------------------------------------------ *
 * 營運概況
 * ------------------------------------------------------------------ */

async function loadStats() {
    const container = document.getElementById('admin-stats');
    const topMoviesBox = document.getElementById('admin-top-movies');

    let stats;
    try {
        stats = await DataAPI.getAdminStats();
    } catch (error) {
        container.innerHTML = `<div class="col-12"><div class="alert alert-danger">${escapeHtml(error.message)}</div></div>`;
        return;
    }

    const cards = [
        { label: '票房淨額', value: `NT$ ${stats.revenue.net.toLocaleString()}`, tone: 'is-gold',
          hint: `總額 ${stats.revenue.gross.toLocaleString()} · 退款 ${stats.revenue.refunded.toLocaleString()}` },
        { label: '售出票數', value: stats.tickets.sold, tone: '',
          hint: `已使用 ${stats.tickets.used} · 已退票 ${stats.tickets.refunded}` },
        { label: '今日上座率', value: `${stats.today.occupancy}%`, tone: 'is-green',
          hint: `${stats.today.sold} / ${stats.today.capacity} 席 · ${stats.today.showtimes} 個場次` },
        { label: '會員人數', value: stats.userCount, tone: '',
          hint: `待付款訂單 ${stats.pendingPayments} 筆` }
    ];

    container.innerHTML = cards.map(card => `
        <div class="col-lg-3 col-sm-6">
            <div class="stat-card">
                <div class="stat-label">${escapeHtml(card.label)}</div>
                <div class="stat-value ${card.tone}">${escapeHtml(card.value)}</div>
                <div class="stat-hint">${escapeHtml(card.hint)}</div>
            </div>
        </div>
    `).join('');

    document.getElementById('admin-updated-at').textContent =
        `更新於 ${new Date().toLocaleTimeString('zh-TW')}`;

    if (stats.topMovies.length === 0) {
        topMoviesBox.innerHTML = '<p class="text-muted mb-0 small">目前還沒有售票紀錄。</p>';
        return;
    }

    const maxSold = Math.max(...stats.topMovies.map(m => m.ticketsSold), 1);

    topMoviesBox.innerHTML = stats.topMovies.map(movie => `
        <div class="top-movie-row">
            <img src="${escapeHtml(movie.posterImage)}" alt="" class="top-movie-poster" loading="lazy">
            <div class="top-movie-info">
                <div class="d-flex justify-content-between align-items-baseline gap-2">
                    <span class="top-movie-title">${escapeHtml(movie.title)}</span>
                    <span class="top-movie-value">${movie.ticketsSold} 張 · NT$ ${movie.revenue.toLocaleString()}</span>
                </div>
                <div class="top-movie-bar">
                    <span style="width: ${(movie.ticketsSold / maxSold) * 100}%"></span>
                </div>
            </div>
        </div>
    `).join('');
}

/* ------------------------------------------------------------------ *
 * 場次管理
 * ------------------------------------------------------------------ */

async function setupShowtimePanel() {
    const tbody = document.getElementById('admin-showtime-list');
    const filterDate = document.getElementById('filter-date');
    const movieSelect = document.getElementById('new-movie');
    const theaterSelect = document.getElementById('new-theater');
    const dateInput = document.getElementById('new-date');

    const [movies, theaters] = await Promise.all([DataAPI.getMovies(), DataAPI.getTheaters()]);

    movieSelect.innerHTML = movies
        .map(m => `<option value="${m.id}">${escapeHtml(m.title)}</option>`).join('');
    theaterSelect.innerHTML = theaters
        .map(t => `<option value="${t.id}">${escapeHtml(t.name)}（${t.totalRows * t.totalCols} 席）</option>`).join('');

    const today = DataAPI.getLocalDateStr();
    dateInput.min = today;
    dateInput.value = today;

    const scroller = new InfiniteScroll({
        container: document.getElementById('showtime-admin-sentinel'),
        pageSize: 20,
        loadPage: async (offset, limit) => {
            const page = await DataAPI.getAdminShowtimes({ date: filterDate.value, limit, offset });
            return { items: page.showtimes, total: page.total, hasMore: page.hasMore };
        },
        render: (showtimes, { isFirstPage }) => {
            if (isFirstPage) tbody.innerHTML = '';
            tbody.insertAdjacentHTML('beforeend', showtimes.map(renderShowtimeRow).join(''));
        },
        onEmpty: () => {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">沒有符合條件的場次</td></tr>';
        }
    });

    scroller.reset();

    filterDate.addEventListener('change', () => scroller.reset());

    document.getElementById('create-showtime-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = e.target.querySelector('button[type=submit]');
        submitBtn.disabled = true;

        try {
            await DataAPI.createShowtime({
                movieId: Number(movieSelect.value),
                theaterId: Number(theaterSelect.value),
                date: dateInput.value,
                time: document.getElementById('new-time').value,
                price: Number(document.getElementById('new-price').value)
            });
            AuthManager.showToast('排片成功', 'success');
            filterDate.value = dateInput.value;
            scroller.reset();
            loadStats();
        } catch (error) {
            AuthManager.showToast(error.message || '排片失敗', 'danger');
        } finally {
            submitBtn.disabled = false;
        }
    });

    // 刪除場次
    tbody.addEventListener('click', async (e) => {
        const btn = e.target.closest('.delete-showtime-btn');
        if (!btn) return;

        if (!window.confirm(`確定要刪除 ${btn.dataset.label} 這個場次嗎？`)) return;

        btn.disabled = true;
        try {
            await DataAPI.deleteShowtime(btn.dataset.showtimeId);
            AuthManager.showToast('場次已刪除', 'success');
            scroller.reset();
            loadStats();
        } catch (error) {
            AuthManager.showToast(error.message || '刪除失敗', 'danger');
            btn.disabled = false;
        }
    });
}

function renderShowtimeRow(showtime) {
    const label = `${showtime.date} ${showtime.time} ${showtime.movieTitle}`;
    const tone = showtime.occupancy >= 70 ? 'is-high' : (showtime.occupancy >= 30 ? 'is-mid' : '');

    return `
        <tr>
            <td class="small">${escapeHtml(showtime.date)}</td>
            <td class="fw-bold">${escapeHtml(showtime.time)}</td>
            <td class="small">${escapeHtml(showtime.movieTitle)}</td>
            <td class="small">${escapeHtml(showtime.theaterName)}</td>
            <td class="small">NT$ ${showtime.price}</td>
            <td class="small">${showtime.sold} / ${showtime.capacity}</td>
            <td style="min-width: 120px;">
                <div class="occupancy-bar ${tone}">
                    <span style="width: ${Math.min(showtime.occupancy, 100)}%"></span>
                </div>
                <span class="small text-muted">${showtime.occupancy}%</span>
            </td>
            <td class="text-end">
                <button type="button" class="btn btn-sm btn-outline-secondary delete-showtime-btn"
                        data-showtime-id="${showtime.id}" data-label="${escapeHtml(label)}"
                        ${showtime.sold > 0 ? 'disabled title="已售票，無法刪除"' : ''}>
                    刪除
                </button>
            </td>
        </tr>
    `;
}

/* ------------------------------------------------------------------ *
 * 訂單管理
 * ------------------------------------------------------------------ */

async function setupBookingPanel() {
    const container = document.getElementById('admin-booking-list');

    const scroller = new InfiniteScroll({
        container: document.getElementById('booking-admin-sentinel'),
        pageSize: 15,
        loadPage: async (offset, limit) => {
            const page = await DataAPI.getAdminBookings({ limit, offset });
            return { items: page.bookings, total: page.total, hasMore: page.hasMore };
        },
        render: (bookings, { isFirstPage }) => {
            if (isFirstPage) container.innerHTML = '';
            container.insertAdjacentHTML('beforeend', bookings.map(renderBookingCard).join(''));
        },
        onEmpty: () => {
            container.innerHTML = '<p class="text-muted text-center py-4 mb-0">目前沒有任何訂單</p>';
        }
    });

    scroller.reset();

    // 代客退票
    container.addEventListener('click', async (e) => {
        const btn = e.target.closest('.admin-refund-btn');
        if (!btn) return;

        if (!window.confirm(`確定要為 ${btn.dataset.username} 退掉座位 ${btn.dataset.seat} 嗎？`)) return;

        btn.disabled = true;
        try {
            const result = await DataAPI.adminRefundTicket(btn.dataset.ticketId);
            AuthManager.showToast(`已退票，退款 NT$ ${result.refundAmount}`, 'success');
            scroller.reset();
            loadStats();
        } catch (error) {
            AuthManager.showToast(error.message || '退票失敗', 'danger');
            btn.disabled = false;
        }
    });
}

function renderBookingCard(booking) {
    const statusMap = {
        Paid: { label: '已付款', cls: 'bg-success' },
        PartiallyRefunded: { label: '部分退票', cls: 'bg-warning' },
        Refunded: { label: '已全退', cls: 'bg-danger' }
    };
    const status = statusMap[booking.status] || { label: booking.status, cls: 'bg-secondary' };

    return `
        <div class="admin-booking">
            <div class="admin-booking-head">
                <div>
                    <span class="fw-bold">#${booking.id}</span>
                    <span class="text-muted small ms-2">${escapeHtml(booking.username)}</span>
                </div>
                <span class="badge ${status.cls}">${escapeHtml(status.label)}</span>
            </div>
            <div class="admin-booking-body">
                <p class="mb-1 small">
                    <strong>${escapeHtml(booking.movieTitle)}</strong>
                    <span class="text-muted">· ${escapeHtml(booking.date)} ${escapeHtml(booking.time)} · ${escapeHtml(booking.theaterName)}</span>
                </p>
                <p class="mb-2 small text-muted">
                    金額 NT$ ${booking.totalAmount}
                    ${booking.refundedAmount > 0 ? `· 已退 NT$ ${booking.refundedAmount}` : ''}
                    · ${escapeHtml(booking.createdAt)}
                </p>
                <div class="admin-seat-list">
                    ${booking.seats.map(seat => `
                        <span class="admin-seat ${seat.status === 'refunded' ? 'is-refunded' : ''}">
                            ${escapeHtml(seat.label)}
                            <small>${seatStatusLabel(seat.status)}</small>
                            ${seat.status === 'unused' ? `
                                <button type="button" class="admin-refund-btn"
                                        data-ticket-id="${seat.id}"
                                        data-seat="${escapeHtml(seat.label)}"
                                        data-username="${escapeHtml(booking.username)}"
                                        title="代客退票">退票</button>
                            ` : ''}
                        </span>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
}

function seatStatusLabel(status) {
    return { unused: '未使用', using: '使用中', used: '已使用', refunded: '已退票' }[status] || status;
}

/* ------------------------------------------------------------------ *
 * 會員
 * ------------------------------------------------------------------ */

async function setupUserPanel() {
    const tbody = document.getElementById('admin-user-list');

    new InfiniteScroll({
        container: document.getElementById('user-admin-sentinel'),
        pageSize: 20,
        loadPage: async (offset, limit) => {
            const page = await DataAPI.getAdminUsers({ limit, offset });
            return { items: page.users, total: page.total, hasMore: page.hasMore };
        },
        render: (users, { isFirstPage }) => {
            if (isFirstPage) tbody.innerHTML = '';
            tbody.insertAdjacentHTML('beforeend', users.map(user => `
                <tr>
                    <td class="small">${user.id}</td>
                    <td class="small fw-bold">${escapeHtml(user.username)}</td>
                    <td class="small text-muted">${escapeHtml(user.email)}</td>
                    <td>
                        <span class="badge ${user.role === 'admin' ? 'bg-warning' : 'bg-secondary'}">
                            ${user.role === 'admin' ? '管理員' : '會員'}
                        </span>
                    </td>
                    <td class="small">NT$ ${user.balance}</td>
                    <td class="small">${user.bookingCount}</td>
                    <td class="small">${user.ticketCount}</td>
                </tr>
            `).join(''));
        },
        onEmpty: () => {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">沒有會員資料</td></tr>';
        }
    }).reset();
}
