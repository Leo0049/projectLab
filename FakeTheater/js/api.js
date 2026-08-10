/**
 * 前端資料存取層（DataAPI）
 *
 * 全部資料都來自後端 REST API，瀏覽器只負責顯示。
 * localStorage 現在只存一樣東西：登入權杖。餘額、座位、票券一律以伺服器為準。
 *
 * 對應的後端程式在 server/routes/。
 */

const TOKEN_KEY = 'ft_token';

/**
 * 帶著 HTTP 狀態與後端附加資訊的錯誤，讓呼叫端能分辨「座位被搶走」與「網路斷線」
 */
class ApiError extends Error {
    constructor(message, status, details) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.details = details;
    }
}

const DataAPI = {
    baseUrl: '/api',

    // 電影與影廳幾乎不變，快取起來少打幾次 API
    CACHE_DURATION: 5 * 60 * 1000,
    cache: {
        movies: { data: null, timestamp: null },
        theaters: { data: null, timestamp: null }
    },

    /* -------------------------------------------------------------- *
     * 權杖
     * -------------------------------------------------------------- */

    getToken() {
        try {
            return localStorage.getItem(TOKEN_KEY);
        } catch (error) {
            return null;
        }
    },

    setToken(token) {
        try {
            if (token) {
                localStorage.setItem(TOKEN_KEY, token);
            } else {
                localStorage.removeItem(TOKEN_KEY);
            }
        } catch (error) {
            console.error('無法儲存登入狀態', error);
        }
    },

    /* -------------------------------------------------------------- *
     * 底層請求
     * -------------------------------------------------------------- */

    /**
     * @param {string} method
     * @param {string} endpoint - 例如 '/movies'
     * @param {Object} [body]
     * @returns {Promise<Object>}
     * @throws {ApiError}
     */
    async request(method, endpoint, body) {
        const headers = {};
        const token = this.getToken();
        if (token) headers.Authorization = `Bearer ${token}`;
        if (body !== undefined) headers['Content-Type'] = 'application/json';

        let response;
        try {
            response = await fetch(`${this.baseUrl}${endpoint}`, {
                method,
                headers,
                body: body === undefined ? undefined : JSON.stringify(body)
            });
        } catch (error) {
            throw new ApiError('無法連線到伺服器，請確認服務是否啟動', 0);
        }

        let data = null;
        try {
            data = await response.json();
        } catch (error) { /* 204 之類沒有 body */ }

        if (!response.ok) {
            // 權杖失效就直接清掉，避免整站卡在半登入狀態
            if (response.status === 401 && token) {
                this.setToken(null);
            }
            throw new ApiError(data?.error || `請求失敗（${response.status}）`, response.status, data?.details);
        }

        return data;
    },

    get(endpoint) { return this.request('GET', endpoint); },
    post(endpoint, body) { return this.request('POST', endpoint, body); },
    patch(endpoint, body) { return this.request('PATCH', endpoint, body); },
    del(endpoint) { return this.request('DELETE', endpoint); },

    /* -------------------------------------------------------------- *
     * 日期與座位工具
     * -------------------------------------------------------------- */

    /**
     * 取得本地時區的 YYYY-MM-DD（不可用 toISOString，那是 UTC）
     */
    getLocalDateStr(date = new Date()) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    },

    /**
     * 取得未來 N 天的日期列表
     */
    getNextDays(days = 5) {
        const result = [];
        const today = new Date();
        const dayNames = ['日', '一', '二', '三', '四', '五', '六'];

        for (let i = 0; i < days; i++) {
            const date = new Date(today);
            date.setDate(today.getDate() + i);
            result.push({
                dateStr: this.getLocalDateStr(date),
                displayStr: `${date.getMonth() + 1}/${date.getDate()}`,
                dayOfWeek: dayNames[date.getDay()],
                isToday: i === 0
            });
        }

        return result;
    },

    /**
     * {row:1, col:1} → "A1"
     */
    formatSeatLabel(seat) {
        if (!seat) return '';
        return `${String.fromCharCode(64 + Number(seat.row))}${seat.col}`;
    },

    /* -------------------------------------------------------------- *
     * 電影與影廳
     * -------------------------------------------------------------- */

    isCacheExpired(key) {
        const entry = this.cache[key];
        if (!entry || !entry.data || !entry.timestamp) return true;
        return (Date.now() - entry.timestamp) > this.CACHE_DURATION;
    },

    async getMovies() {
        if (!this.isCacheExpired('movies')) return this.cache.movies.data;

        const { movies } = await this.get('/movies');
        this.cache.movies = { data: movies, timestamp: Date.now() };
        return movies;
    },

    async getMovieById(id) {
        const movies = await this.getMovies();
        return movies.find(m => m.id === parseInt(id)) || null;
    },

    async getMoviesByCategory(category) {
        const movies = await this.getMovies();
        return movies.filter(m => m.category === category);
    },

    async getTheaters() {
        if (!this.isCacheExpired('theaters')) return this.cache.theaters.data;

        const { theaters } = await this.get('/theaters');
        this.cache.theaters = { data: theaters, timestamp: Date.now() };
        return theaters;
    },

    async getTheaterById(id) {
        const theaters = await this.getTheaters();
        return theaters.find(t => t.id === parseInt(id)) || null;
    },

    /* -------------------------------------------------------------- *
     * 場次
     * -------------------------------------------------------------- */

    /**
     * 取得場次（後端已排除開演過的場次，並附上電影與影廳資訊）
     * @param {Object} filters - {movieId, date, theaterId}
     */
    async getShowtimes(filters = {}) {
        const params = new URLSearchParams();
        if (filters.movieId) params.set('movieId', filters.movieId);
        if (filters.date) params.set('date', filters.date);
        if (filters.theaterId) params.set('theaterId', filters.theaterId);

        const query = params.toString();
        const { showtimes } = await this.get(`/showtimes${query ? '?' + query : ''}`);
        return showtimes;
    },

    async getShowtimesByMovie(movieId) {
        return this.getShowtimes({ movieId });
    },

    async getShowtimeById(id) {
        const showtimes = await this.getShowtimes();
        return showtimes.find(st => st.id === parseInt(id)) || null;
    },

    /* -------------------------------------------------------------- *
     * 座位
     * -------------------------------------------------------------- */

    /**
     * 取得座位圖
     * @returns {Promise<{showtime:Object, occupied:Array, locked:Array, heldByMe:Array}>}
     */
    async getSeatMap(showtimeId) {
        return this.get(`/showtimes/${parseInt(showtimeId)}/seats`);
    },

    /**
     * 選位後暫時保留座位，讓使用者安心結帳
     * @returns {Promise<{expiresAt:number}>}
     */
    async lockSeats(showtimeId, seats) {
        return this.post(`/showtimes/${parseInt(showtimeId)}/locks`, { seats });
    },

    /**
     * 放棄結帳時把位子還回去
     */
    async releaseSeats(showtimeId) {
        return this.del(`/showtimes/${parseInt(showtimeId)}/locks`);
    },

    /* -------------------------------------------------------------- *
     * 訂票與票券
     * -------------------------------------------------------------- */

    /**
     * 付款並開票。扣款與座位檢查都在伺服器完成。
     * @returns {Promise<{booking:Object, balance:number}>}
     */
    async createBooking({ showtimeId, seats }) {
        return this.post('/bookings', { showtimeId: parseInt(showtimeId), seats });
    },

    /**
     * @returns {Promise<{active:Array, history:Array}>}
     */
    async getTickets() {
        return this.get('/tickets');
    },

    async useTicket(ticketId) {
        return this.post(`/tickets/${parseInt(ticketId)}/use`);
    },

    async getTicketStats() {
        return this.get('/tickets/stats');
    },

    /* -------------------------------------------------------------- *
     * 帳號與錢包
     * -------------------------------------------------------------- */

    async login(username, password) {
        return this.post('/auth/login', { username, password });
    },

    async register(username, password, email) {
        return this.post('/auth/register', { username, password, email });
    },

    async getMe() {
        return this.get('/auth/me');
    },

    async updateUsername(username) {
        return this.patch('/auth/me', { username });
    },

    async deposit(amount) {
        return this.post('/wallet/deposit', { amount });
    },

    async getTransactions() {
        const { transactions } = await this.get('/wallet/transactions');
        return transactions;
    },

    clearCache() {
        Object.keys(this.cache).forEach(key => {
            this.cache[key] = { data: null, timestamp: null };
        });
    }
};
