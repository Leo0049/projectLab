/**
 * 資料存取層（DataAPI）
 *
 * 資料來源優先序：
 *   1. 以 http(s):// 開啟時 → fetch data/*.json
 *   2. 以 file:// 開啟、或 fetch 失敗 → 使用本檔內嵌的種子資料（EMBEDDED_*）
 *
 * 場次（showtimes）一律以「今天」為基準動態產生，不從靜態檔讀取，
 * 避免寫死的日期過期後整站查不到任何場次。
 *
 * 使用者、訂票、交易紀錄一律存放於 localStorage，DataAPI 是唯一的讀寫入口。
 */

/* ------------------------------------------------------------------ *
 * 內嵌種子資料（內容需與 data/*.json 保持一致）
 * ------------------------------------------------------------------ */

const EMBEDDED_MOVIES = [
    {
        "id": 1,
        "title": "NEO-SHADOW",
        "description": "在未來的霓虹城市中，一名失憶的駭客必須揭開自己的過去，同時對抗控制城市的邪惡企業。當真相逐漸浮現，他發現自己竟是這場陰謀的核心。一場關於身份、記憶與自由的史詩冒險即將展開。",
        "posterImage": "pic/1.png",
        "hposterImage": "pic/1-1.png",
        "category": "NowShowing",
        "rating": 9.0,
        "duration": "135 分鐘",
        "ratingClass": "輔12級",
        "releaseDate": "2025/12/01"
    },
    {
        "id": 2,
        "title": "The Silk Thread",
        "description": "一條神秘的絲線串連起三代人的命運，揭露一個隱藏百年的家族秘密。從戰火紛飛的年代到現代都市，這條絲線見證了愛恨情仇、生離死別。",
        "posterImage": "pic/2.png",
        "hposterImage": "pic/2-1.png",
        "category": "NowShowing",
        "rating": 8.5,
        "duration": "128 分鐘",
        "ratingClass": "普遍級",
        "releaseDate": "2025/11/15"
    },
    {
        "id": 3,
        "title": "Neon Requiem",
        "description": "在永不熄滅的霓虹之城，半人半機器的戰士與頹廢偵探聯手，試圖揭開隱藏在奢華光影下的權力陰謀。當黑暗獵殺者步步逼近，他們必須在雨夜的爆破中殺出一條血路，守住人類最後的尊嚴。",
        "posterImage": "pic/3.png",
        "hposterImage": "pic/3-1.png",
        "category": "NowShowing",
        "rating": 8.8,
        "duration": "118 分鐘",
        "ratingClass": "輔12級",
        "releaseDate": "2025/12/20"
    },
    {
        "id": 4,
        "title": "Echoes Of Titan",
        "description": "人類在土衛六建立的殖民地收到來自深空的神秘訊號，一支探險隊踏上未知的旅程。他們將發現，宇宙中並不只有人類，而那些「回音」背後隱藏著改變人類命運的真相。",
        "posterImage": "pic/4.png",
        "hposterImage": "pic/4-1.png",
        "category": "TopPick",
        "rating": 9.2,
        "duration": "152 分鐘",
        "ratingClass": "輔12級",
        "releaseDate": "2025/11/28"
    },
    {
        "id": 5,
        "title": "劇場版『鏈鋸人 蕾潔篇』",
        "description": "在惡魔、獵人與潛藏敵人交鋒的殘酷戰爭中，一位神秘少女蕾潔，闘入了淀治的世界。面對史上最致命的對決，淀治將在這個毫無規則可言的生存遊戲中，被愛推向命運的漩渦。",
        "posterImage": "pic/5.jpg",
        "hposterImage": "pic/5-1.png",
        "category": "NowShowing",
        "rating": 9.5,
        "duration": "145 分鐘",
        "ratingClass": "限制級",
        "releaseDate": "2025/12/06"
    },
    {
        "id": 6,
        "title": "動物方城市2",
        "description": "茱蒂與尼克再度攜手，這次要解決一起撼動動物方城市根基的神秘案件。當城市陷入前所未有的危機，這對黃金搭檔必須證明，正義與友情的力量能戰勝一切。",
        "posterImage": "pic/6.jpg",
        "hposterImage": "pic/6-1.png",
        "category": "ComingSoon",
        "rating": 9.5,
        "duration": "107 分鐘",
        "ratingClass": "普遍級",
        "releaseDate": "2025/12/25"
    },
    {
        "id": 7,
        "title": "出神入化 3",
        "description": "四騎士重出江湖，這次的對手將是前所未有的強大。當魔術與科技結合，真假難辨的世界中，誰才是真正的操控者？一場巔峰對決，即將上演。",
        "posterImage": "pic/7.jpg",
        "hposterImage": "pic/7-1.png",
        "category": "ComingSoon",
        "rating": 8.3,
        "duration": "112 分鐘",
        "ratingClass": "保護級",
        "releaseDate": "2025/12/12"
    },
    {
        "id": 8,
        "title": "劇場版 咒術迴戰 澀谷事變×死滅迴游",
        "description": "澀谷事變的慘烈戰鬥，與死滅迴游的殘酷遊戲，即將在大銀幕上震撼呈現。虎杖悠仁與夥伴們將面對最黑暗的時刻，為了保護所愛之人而戰。",
        "posterImage": "pic/8.jpg",
        "hposterImage": "pic/8-1.png",
        "category": "TopPick",
        "rating": 9.4,
        "duration": "87 分鐘",
        "ratingClass": "輔15級",
        "releaseDate": "2025/12/18"
    }
];

const EMBEDDED_THEATERS = [
    { "id": 1, "name": "1廳", "totalRows": 8, "totalCols": 12 },
    { "id": 2, "name": "IMAX廳", "totalRows": 10, "totalCols": 15 },
    { "id": 3, "name": "VIP廳", "totalRows": 5, "totalCols": 8 }
];

const EMBEDDED_USERS = [
    { "id": 1, "username": "johndoe", "password": "password123", "balance": 1000.00 },
    { "id": 2, "username": "janedoe", "password": "securepass", "balance": 500.00 },
    { "id": 3, "username": "demo", "password": "demo123", "balance": 2000.00 }
];

// 種子訂位：讓座位圖一開始就有「已被別人訂走」的位子
const EMBEDDED_BOOKINGS = [
    { "id": 1, "showtimeId": 1, "seats": [{ "row": 4, "col": 5 }, { "row": 4, "col": 6 }], "status": "Paid" },
    { "id": 2, "showtimeId": 3, "seats": [{ "row": 5, "col": 7 }, { "row": 5, "col": 8 }], "status": "Paid" },
    { "id": 3, "showtimeId": 6, "seats": [{ "row": 3, "col": 4 }], "status": "Paid" }
];

/* ------------------------------------------------------------------ *
 * 場次產生規則
 * ------------------------------------------------------------------ */

const SCHEDULE_DAYS = 7;                                            // 一次排未來幾天
const SCHEDULE_TIMES = ['10:30', '13:00', '15:30', '18:00', '20:30', '23:00'];
const SCHEDULE_PRICES = [250, 280, 350, 300, 320, 380];

const DataAPI = {
    CACHE_DURATION: 5 * 60 * 1000,

    cache: {
        movies: { data: null, timestamp: null },
        theaters: { data: null, timestamp: null },
        showtimes: { data: null, timestamp: null },
        users: { data: null, timestamp: null }
    },

    // localStorage 的鍵名，集中管理避免各模組各寫各的
    STORAGE_KEYS: {
        USERS: 'users',
        LEGACY_USERS: 'registeredUsers',
        BOOKINGS: 'bookings',
        USED_TICKETS: 'usedTickets',
        TRANSACTIONS: 'transactions',
        SESSION: 'userInfo'
    },

    basePath: 'data/',

    useEmbeddedData: window.location.protocol === 'file:',

    /* -------------------------------------------------------------- *
     * localStorage 存取
     * -------------------------------------------------------------- */

    /**
     * 讀取 localStorage 並解析 JSON，失敗時回傳預設值而不是讓整頁壞掉
     * @param {string} key
     * @param {*} fallback
     */
    read(key, fallback = []) {
        try {
            const raw = localStorage.getItem(key);
            return raw === null ? fallback : JSON.parse(raw);
        } catch (error) {
            console.warn(`localStorage.${key} 內容毀損，已忽略`, error);
            return fallback;
        }
    },

    /**
     * 寫入 localStorage
     * @param {string} key
     * @param {*} value
     * @returns {boolean} 是否成功
     */
    write(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (error) {
            console.error(`寫入 localStorage.${key} 失敗`, error);
            return false;
        }
    },

    /* -------------------------------------------------------------- *
     * 日期工具
     * -------------------------------------------------------------- */

    /**
     * 取得本地時區的 YYYY-MM-DD（不可用 toISOString，那是 UTC）
     * @param {Date} date
     * @returns {string}
     */
    getLocalDateStr(date = new Date()) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    },

    /**
     * 取得未來 N 天的日期列表
     * @param {number} days - 天數（預設 5 天）
     * @returns {Array<{dateStr:string, displayStr:string, dayOfWeek:string, isToday:boolean}>}
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
     * 座位物件轉為顯示標籤，全站統一 1 起算：{row:1, col:1} → "A1"
     * @param {{row:number, col:number}} seat
     * @returns {string}
     */
    formatSeatLabel(seat) {
        if (!seat) return '';
        return `${String.fromCharCode(64 + Number(seat.row))}${seat.col}`;
    },

    /* -------------------------------------------------------------- *
     * 資料載入
     * -------------------------------------------------------------- */

    isCacheExpired(dataType) {
        const cacheEntry = this.cache[dataType];
        if (!cacheEntry || !cacheEntry.data || !cacheEntry.timestamp) {
            return true;
        }
        return (Date.now() - cacheEntry.timestamp) > this.CACHE_DURATION;
    },

    /**
     * 取得內嵌種子資料
     * @param {string} dataType
     */
    getEmbedded(dataType) {
        const embedded = {
            movies: EMBEDDED_MOVIES,
            theaters: EMBEDDED_THEATERS,
            users: EMBEDDED_USERS,
            bookings: EMBEDDED_BOOKINGS
        };
        return embedded[dataType] || [];
    },

    /**
     * 載入靜態資料（movies / theaters / users / bookings）
     * showtimes 不走這裡，一律動態產生
     * @param {string} dataType
     * @returns {Promise<Array>}
     */
    async loadData(dataType) {
        if (this.cache[dataType] && !this.isCacheExpired(dataType)) {
            return this.cache[dataType].data;
        }

        let data;

        if (this.useEmbeddedData) {
            data = this.getEmbedded(dataType);
        } else {
            try {
                const response = await fetch(`${this.basePath}${dataType}.json`);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                data = await response.json();
            } catch (error) {
                console.warn(`載入 ${dataType}.json 失敗，改用內嵌資料:`, error);
                data = this.getEmbedded(dataType);
            }
        }

        if (this.cache[dataType]) {
            this.cache[dataType] = { data: data, timestamp: Date.now() };
        }
        return data;
    },

    /* -------------------------------------------------------------- *
     * 電影
     * -------------------------------------------------------------- */

    async getMovies() {
        return this.loadData('movies');
    },

    /**
     * @param {number|string} id
     * @returns {Promise<Object|null>}
     */
    async getMovieById(id) {
        const movies = await this.getMovies();
        return movies.find(m => m.id === parseInt(id)) || null;
    },

    /**
     * @param {string} category - NowShowing / TopPick / ComingSoon
     * @returns {Promise<Array>}
     */
    async getMoviesByCategory(category) {
        const movies = await this.getMovies();
        return movies.filter(m => m.category === category);
    },

    /* -------------------------------------------------------------- *
     * 影廳
     * -------------------------------------------------------------- */

    async getTheaters() {
        return this.loadData('theaters');
    },

    async getTheaterById(id) {
        const theaters = await this.getTheaters();
        return theaters.find(t => t.id === parseInt(id)) || null;
    },

    /* -------------------------------------------------------------- *
     * 場次
     * -------------------------------------------------------------- */

    /**
     * 以今天為起點產生未來 SCHEDULE_DAYS 天的場次
     * 同一天同一部片的場次組合是固定的，重新整理不會跳動
     * @param {Array} movies
     * @param {Array} theaters
     * @returns {Array}
     */
    generateShowtimes(movies, theaters) {
        const showtimes = [];
        const today = new Date();
        let id = 1;

        for (let dayOffset = 0; dayOffset < SCHEDULE_DAYS; dayOffset++) {
            const date = new Date(today);
            date.setDate(today.getDate() + dayOffset);
            const dateStr = this.getLocalDateStr(date);

            movies.forEach((movie, movieIndex) => {
                const numShowtimes = 3 + (movieIndex % 2);
                const times = SCHEDULE_TIMES.slice(0, numShowtimes);

                times.forEach((time, index) => {
                    const theater = theaters[(movieIndex + index) % theaters.length];
                    showtimes.push({
                        id: id++,
                        movieId: movie.id,
                        theaterId: theater.id,
                        date: dateStr,
                        time: time,
                        price: SCHEDULE_PRICES[(movieIndex + index) % SCHEDULE_PRICES.length]
                    });
                });
            });
        }

        return showtimes;
    },

    /**
     * 取得所有場次（已排除過去的場次，並補上電影／影廳資訊）
     * @param {Object} filters - {movieId, date, theaterId}
     * @returns {Promise<Array>}
     */
    async getShowtimes(filters = {}) {
        const [movies, theaters] = await Promise.all([this.getMovies(), this.getTheaters()]);

        if (this.isCacheExpired('showtimes')) {
            this.cache.showtimes = {
                data: this.generateShowtimes(movies, theaters),
                timestamp: Date.now()
            };
        }

        const now = new Date();
        const todayStr = this.getLocalDateStr(now);
        const currentTime = now.toTimeString().slice(0, 5); // "HH:mm"

        let results = this.cache.showtimes.data
            .filter(st => {
                if (st.date < todayStr) return false;
                if (st.date === todayStr && st.time < currentTime) return false;
                return true;
            })
            .map(st => {
                const movie = movies.find(m => m.id === st.movieId);
                const theater = theaters.find(t => t.id === st.theaterId);
                return {
                    ...st,
                    movieTitle: movie?.title || '未知電影',
                    moviePoster: movie?.posterImage || '',
                    movieRating: movie?.rating || 0,
                    theaterName: theater?.name || '未知影廳',
                    theaterRows: theater?.totalRows || 8,
                    theaterCols: theater?.totalCols || 12
                };
            });

        if (filters.movieId) {
            results = results.filter(st => st.movieId === parseInt(filters.movieId));
        }
        if (filters.date) {
            results = results.filter(st => st.date === filters.date);
        }
        if (filters.theaterId) {
            results = results.filter(st => st.theaterId === parseInt(filters.theaterId));
        }

        results.sort((a, b) => {
            if (a.date !== b.date) return a.date.localeCompare(b.date);
            return a.time.localeCompare(b.time);
        });

        return results;
    },

    async getShowtimesByMovie(movieId) {
        return this.getShowtimes({ movieId });
    },

    async getShowtimeById(id) {
        const showtimes = await this.getShowtimes();
        return showtimes.find(st => st.id === parseInt(id)) || null;
    },

    /* -------------------------------------------------------------- *
     * 訂票
     * -------------------------------------------------------------- */

    /**
     * 取得所有訂票（種子資料 + 本機訂票）
     * @returns {Promise<Array>}
     */
    async getBookings() {
        const seed = await this.loadData('bookings');
        return [...seed, ...this.read(this.STORAGE_KEYS.BOOKINGS)];
    },

    /**
     * 取得指定使用者的訂票（種子資料不屬於任何人，不會出現）
     * @param {number} userId
     * @returns {Array}
     */
    getBookingsByUser(userId) {
        return this.read(this.STORAGE_KEYS.BOOKINGS).filter(b => b.userId === userId);
    },

    /**
     * 取得指定場次已被訂走的座位（不分使用者）
     * @param {number|string} showtimeId
     * @returns {Promise<Array<{row:number, col:number}>>}
     */
    async getBookedSeats(showtimeId) {
        const bookings = await this.getBookings();
        const bookedSeats = [];

        bookings.forEach(booking => {
            if (booking.showtimeId === parseInt(showtimeId) && booking.status === 'Paid') {
                bookedSeats.push(...(booking.seats || []));
            }
        });

        return bookedSeats;
    },

    /**
     * 建立訂票。會再次檢查座位是否已被搶走，避免重複售出。
     * @param {Object} bookingData
     * @returns {Promise<{success:boolean, booking?:Object, message?:string}>}
     */
    async createBooking(bookingData) {
        try {
            const showtimeId = parseInt(bookingData.showtimeId);
            const seats = bookingData.seats || [];

            if (!showtimeId || seats.length === 0) {
                return { success: false, message: '訂票資料不完整' };
            }

            // 併發保護：付款前有人先訂走同一個位子就擋下來
            const bookedSeats = await this.getBookedSeats(showtimeId);
            const conflict = seats.find(seat =>
                bookedSeats.some(b => Number(b.row) === Number(seat.row) && Number(b.col) === Number(seat.col))
            );
            if (conflict) {
                return { success: false, message: `座位 ${this.formatSeatLabel(conflict)} 已被訂走，請重新選位` };
            }

            const newBooking = {
                id: Date.now(),
                userId: bookingData.userId ?? null,
                showtimeId: showtimeId,
                seats: seats,
                seatStatuses: seats.map(() => 'unused'),
                seatUsedAt: seats.map(() => null),
                movieId: bookingData.movieId ?? null,
                movieTitle: bookingData.movieTitle || '電影票',
                moviePoster: bookingData.moviePoster || '',
                date: bookingData.date || '',
                time: bookingData.time || '',
                theaterName: bookingData.theaterName || '',
                pricePerSeat: bookingData.pricePerSeat || 0,
                status: 'Paid',
                createdAt: new Date().toISOString()
            };

            const storedBookings = this.read(this.STORAGE_KEYS.BOOKINGS);
            storedBookings.push(newBooking);

            if (!this.write(this.STORAGE_KEYS.BOOKINGS, storedBookings)) {
                return { success: false, message: '無法儲存訂票資料（瀏覽器儲存空間已滿？）' };
            }

            return { success: true, booking: newBooking };
        } catch (error) {
            console.error('createBooking error:', error);
            return { success: false, message: error.message };
        }
    },

    /* -------------------------------------------------------------- *
     * 使用者
     * -------------------------------------------------------------- */

    /**
     * 取得使用者清單。第一次執行時會把 data/users.json 的預設帳號寫入 localStorage，
     * 之後 localStorage 就是唯一來源，因此餘額變動能夠保留。
     * @returns {Promise<Array>}
     */
    async getUsers() {
        const stored = this.read(this.STORAGE_KEYS.USERS, null);
        if (Array.isArray(stored)) {
            return this.migrateLegacyUsers(stored);
        }

        const seedUsers = await this.loadData('users');
        const users = seedUsers.map(user => ({
            id: user.id,
            username: user.username,
            email: user.email || `${user.username}@faketheater.com`,
            password: user.password,
            balance: user.balance || 0
        }));

        this.write(this.STORAGE_KEYS.USERS, users);
        return this.migrateLegacyUsers(users);
    },

    /**
     * 舊版把註冊帳號存在 registeredUsers，合併進來後移除，避免兩份帳號資料
     * @param {Array} users
     * @returns {Array}
     */
    migrateLegacyUsers(users) {
        const legacy = this.read(this.STORAGE_KEYS.LEGACY_USERS, null);
        if (!Array.isArray(legacy) || legacy.length === 0) {
            if (legacy !== null) localStorage.removeItem(this.STORAGE_KEYS.LEGACY_USERS);
            return users;
        }

        const merged = [...users];
        legacy.forEach(old => {
            if (!merged.some(u => u.username === old.username)) {
                merged.push({
                    id: old.id,
                    username: old.username,
                    email: old.email || `${old.username}@faketheater.com`,
                    password: old.password,
                    balance: old.balance || 0
                });
            }
        });

        this.write(this.STORAGE_KEYS.USERS, merged);
        localStorage.removeItem(this.STORAGE_KEYS.LEGACY_USERS);
        return merged;
    },

    /**
     * 帳號密碼驗證
     * @returns {Promise<Object|null>} 不含密碼的使用者資料
     */
    async loginUser(username, password) {
        const users = await this.getUsers();
        const user = users.find(u => u.username === username && u.password === password);
        if (!user) return null;
        return { id: user.id, username: user.username, email: user.email, balance: user.balance };
    },

    /**
     * 註冊新帳號
     * @returns {Promise<{success:boolean, user?:Object, message?:string}>}
     */
    async registerUser(username, password, email) {
        const users = await this.getUsers();

        if (users.some(u => u.username === username)) {
            return { success: false, message: '用戶名已存在' };
        }
        if (email && users.some(u => u.email === email)) {
            return { success: false, message: '電子郵件已被使用' };
        }

        const newUser = {
            id: Date.now(),
            username: username,
            email: email || `${username}@faketheater.com`,
            password: password,
            balance: 0
        };

        users.push(newUser);
        this.write(this.STORAGE_KEYS.USERS, users);

        return {
            success: true,
            user: { id: newUser.id, username: newUser.username, email: newUser.email, balance: newUser.balance }
        };
    },

    /**
     * 更新使用者資料（餘額、名稱等），讓變動在重新登入後仍然存在
     * @param {number} userId
     * @param {Object} changes
     * @returns {Promise<boolean>}
     */
    async updateUser(userId, changes) {
        const users = await this.getUsers();
        const index = users.findIndex(u => u.id === userId);
        if (index === -1) return false;

        users[index] = { ...users[index], ...changes, id: users[index].id };
        return this.write(this.STORAGE_KEYS.USERS, users);
    },

    /* -------------------------------------------------------------- *
     * 其他
     * -------------------------------------------------------------- */

    clearCache() {
        Object.keys(this.cache).forEach(key => {
            this.cache[key] = { data: null, timestamp: null };
        });
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = DataAPI;
}
