/**
 * 線上訂票頁邏輯
 *
 * 流程：選電影 → 選日期 → 選場次 → 選座位 → 開啟結帳側邊欄（CheckoutSidebar）
 * 網址可帶入參數直接跳到指定場次，例如：
 *   booking.html?showtime=12&movie=1&date=2026-08-10&time=18:00
 */

const MAX_SEATS_PER_ORDER = 6;

const BookingPage = {
    movies: [],
    showtimes: [],          // 目前這部電影的所有場次
    currentShowtime: null,
    currentMovie: null,
    selectedSeats: [],      // [{row, col}]

    elements: {},

    async init() {
        this.elements = {
            movieSelect: document.getElementById('movie-select'),
            dateSelect: document.getElementById('date-select'),
            showtimeSelect: document.getElementById('showtime-select'),
            movieInfo: document.getElementById('movie-info'),
            seatMap: document.getElementById('seat-map'),
            seatMapContainer: document.getElementById('seat-map-container'),
            seatCount: document.getElementById('selected-seats-count'),
            totalPrice: document.getElementById('total-price'),
            confirmBtn: document.getElementById('confirm-booking')
        };

        if (!this.elements.movieSelect) return;

        this.bindEvents();

        try {
            this.movies = await DataAPI.getMovies();
        } catch (error) {
            console.error('載入電影失敗:', error);
            this.showSeatMessage('無法載入電影資料，請重新整理頁面', 'danger');
            return;
        }

        this.elements.movieSelect.innerHTML =
            '<option value="">請選擇電影</option>' +
            this.movies.map(m => `<option value="${m.id}">${escapeHtml(m.title)}</option>`).join('');

        await this.applyUrlParams();
    },

    /**
     * 依網址參數自動選好電影／日期／場次
     */
    async applyUrlParams() {
        const params = new URLSearchParams(window.location.search);
        const movieId = params.get('movie');
        const date = params.get('date');
        const showtimeId = params.get('showtime');

        if (!movieId || !this.movies.some(m => m.id === parseInt(movieId))) return;

        this.elements.movieSelect.value = movieId;
        await this.onMovieChange();

        if (date && [...this.elements.dateSelect.options].some(o => o.value === date)) {
            this.elements.dateSelect.value = date;
            this.onDateChange();
        }

        if (showtimeId && [...this.elements.showtimeSelect.options].some(o => o.value === showtimeId)) {
            this.elements.showtimeSelect.value = showtimeId;
            await this.onShowtimeChange();
        }
    },

    bindEvents() {
        this.elements.movieSelect.addEventListener('change', () => this.onMovieChange());
        this.elements.dateSelect.addEventListener('change', () => this.onDateChange());
        this.elements.showtimeSelect.addEventListener('change', () => this.onShowtimeChange());
        this.elements.confirmBtn.addEventListener('click', () => this.onConfirm());
    },

    /* -------------------------------------------------------------- *
     * 三段式選單
     * -------------------------------------------------------------- */

    async onMovieChange() {
        const movieId = this.elements.movieSelect.value;

        this.resetSelection();
        this.elements.showtimeSelect.innerHTML = '<option value="">請先選擇日期</option>';
        this.elements.showtimeSelect.disabled = true;

        if (!movieId) {
            this.elements.dateSelect.innerHTML = '<option value="">請先選擇電影</option>';
            this.elements.dateSelect.disabled = true;
            this.renderMovieInfo(null);
            this.showSeatMessage('請先選擇電影與場次');
            return;
        }

        this.currentMovie = this.movies.find(m => m.id === parseInt(movieId)) || null;
        this.renderMovieInfo(this.currentMovie);

        this.showtimes = await DataAPI.getShowtimesByMovie(movieId);

        const dates = [...new Set(this.showtimes.map(st => st.date))];
        if (dates.length === 0) {
            this.elements.dateSelect.innerHTML = '<option value="">無可訂場次</option>';
            this.elements.dateSelect.disabled = true;
            this.showSeatMessage('這部電影目前沒有可訂票的場次', 'info');
            return;
        }

        const dayLabels = {};
        DataAPI.getNextDays(14).forEach(d => { dayLabels[d.dateStr] = d; });

        this.elements.dateSelect.innerHTML =
            '<option value="">請選擇日期</option>' +
            dates.map(d => {
                const info = dayLabels[d];
                const label = info ? `${d}（${info.isToday ? '今天' : '週' + info.dayOfWeek}）` : d;
                return `<option value="${d}">${label}</option>`;
            }).join('');
        this.elements.dateSelect.disabled = false;

        this.showSeatMessage('請選擇日期與場次');
    },

    onDateChange() {
        const date = this.elements.dateSelect.value;
        this.resetSelection();

        if (!date) {
            this.elements.showtimeSelect.innerHTML = '<option value="">請先選擇日期</option>';
            this.elements.showtimeSelect.disabled = true;
            return;
        }

        const dayShowtimes = this.showtimes.filter(st => st.date === date);

        this.elements.showtimeSelect.innerHTML =
            '<option value="">請選擇場次</option>' +
            dayShowtimes.map(st =>
                `<option value="${st.id}">${st.time}　${escapeHtml(st.theaterName)}　NT$ ${st.price}</option>`
            ).join('');
        this.elements.showtimeSelect.disabled = false;

        this.showSeatMessage('請選擇場次');
    },

    async onShowtimeChange() {
        const showtimeId = this.elements.showtimeSelect.value;
        this.resetSelection();

        if (!showtimeId) {
            this.currentShowtime = null;
            this.showSeatMessage('請選擇場次');
            return;
        }

        this.currentShowtime = this.showtimes.find(st => st.id === parseInt(showtimeId)) || null;
        await this.renderSeatMap();
    },

    /* -------------------------------------------------------------- *
     * 座位圖
     * -------------------------------------------------------------- */

    async renderSeatMap() {
        const showtime = this.currentShowtime;
        if (!showtime || !this.elements.seatMap) return;

        this.elements.seatMap.innerHTML = '<p class="text-center text-muted py-4">座位載入中...</p>';

        let bookedSeats = [];
        try {
            bookedSeats = await DataAPI.getBookedSeats(showtime.id);
        } catch (error) {
            console.error('載入座位失敗:', error);
        }

        const isBooked = (row, col) =>
            bookedSeats.some(s => Number(s.row) === row && Number(s.col) === col);

        let html = '';
        for (let row = 1; row <= showtime.theaterRows; row++) {
            html += '<div class="seat-row">';
            html += `<span class="seat-row-label">${String.fromCharCode(64 + row)}</span>`;
            for (let col = 1; col <= showtime.theaterCols; col++) {
                const occupied = isBooked(row, col);
                const label = `${String.fromCharCode(64 + row)}${col}`;
                html += `<button type="button"
                            class="seat ${occupied ? 'occupied' : 'available'}"
                            data-row="${row}" data-col="${col}"
                            title="${label}${occupied ? '（已售出）' : ''}"
                            aria-label="座位 ${label}"
                            ${occupied ? 'disabled aria-disabled="true"' : ''}></button>`;
            }
            html += '</div>';
        }

        this.elements.seatMap.innerHTML = html;

        this.elements.seatMap.querySelectorAll('.seat.available').forEach(seat => {
            seat.addEventListener('click', () => this.toggleSeat(seat));
        });

        this.updateSummary();
    },

    toggleSeat(seatEl) {
        const row = parseInt(seatEl.dataset.row);
        const col = parseInt(seatEl.dataset.col);
        const index = this.selectedSeats.findIndex(s => s.row === row && s.col === col);

        if (index !== -1) {
            this.selectedSeats.splice(index, 1);
            seatEl.classList.remove('selected');
        } else {
            if (this.selectedSeats.length >= MAX_SEATS_PER_ORDER) {
                AuthManager.showToast(`單次最多只能選 ${MAX_SEATS_PER_ORDER} 個座位`, 'warning');
                return;
            }
            this.selectedSeats.push({ row, col });
            seatEl.classList.add('selected');
        }

        this.updateSummary();
    },

    updateSummary() {
        const count = this.selectedSeats.length;
        const price = this.currentShowtime?.price || 0;

        if (this.elements.seatCount) this.elements.seatCount.textContent = count;
        if (this.elements.totalPrice) this.elements.totalPrice.textContent = count * price;
        if (this.elements.confirmBtn) this.elements.confirmBtn.disabled = count === 0;
    },

    resetSelection() {
        this.selectedSeats = [];
        this.updateSummary();
    },

    /**
     * 座位圖區顯示提示訊息（尚未選場次、無場次等）
     */
    showSeatMessage(message, type = 'secondary') {
        if (!this.elements.seatMap) return;
        this.elements.seatMap.innerHTML =
            `<p class="text-center text-${type} py-4 mb-0">${escapeHtml(message)}</p>`;
        this.resetSelection();
    },

    /* -------------------------------------------------------------- *
     * 電影資訊卡
     * -------------------------------------------------------------- */

    renderMovieInfo(movie) {
        const container = this.elements.movieInfo;
        if (!container) return;

        if (!movie) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = `
            <div class="card booking-movie-card shadow-sm">
                <div class="row g-0">
                    <div class="col-md-2 col-4">
                        <img src="${escapeHtml(movie.posterImage)}" class="img-fluid rounded-start w-100"
                             alt="${escapeHtml(movie.title)}" style="object-fit: cover; height: 100%;">
                    </div>
                    <div class="col-md-10 col-8">
                        <div class="card-body">
                            <h5 class="card-title mb-2">${escapeHtml(movie.title)}</h5>
                            <div class="mb-2">
                                <span class="badge bg-warning text-dark">⭐ ${movie.rating}/10</span>
                                <span class="badge bg-info ms-1">${escapeHtml(movie.duration)}</span>
                                <span class="badge bg-secondary ms-1">${escapeHtml(movie.ratingClass)}</span>
                            </div>
                            <p class="card-text text-muted small mb-0">
                                ${escapeHtml(movie.description.substring(0, 90))}...
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    /* -------------------------------------------------------------- *
     * 送出訂單
     * -------------------------------------------------------------- */

    onConfirm() {
        if (!AuthManager.isLoggedIn()) {
            AuthManager.showToast('請先登入才能訂票', 'warning');
            const authModal = new bootstrap.Modal(document.getElementById('authModal'));
            authModal.show();
            return;
        }

        if (!this.currentShowtime || this.selectedSeats.length === 0) {
            AuthManager.showToast('請先選擇場次與座位', 'warning');
            return;
        }

        const showtime = this.currentShowtime;
        const seats = [...this.selectedSeats].sort((a, b) => a.row - b.row || a.col - b.col);

        CheckoutSidebar.open({
            showtimeId: showtime.id,
            movieId: showtime.movieId,
            movieTitle: showtime.movieTitle,
            moviePoster: showtime.moviePoster,
            date: showtime.date,
            time: showtime.time,
            theaterName: showtime.theaterName,
            seats: seats,
            seatLabels: seats.map(s => DataAPI.formatSeatLabel(s)).join('、'),
            pricePerSeat: showtime.price,
            totalAmount: showtime.price * seats.length
        });
    }
};

/**
 * 供 CheckoutSidebar 付款成功後呼叫：重畫座位圖並清空選擇
 */
async function refreshSeatMap() {
    BookingPage.resetSelection();
    if (BookingPage.currentShowtime) {
        await BookingPage.renderSeatMap();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    BookingPage.init();
});
