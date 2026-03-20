const EMBEDDED_MOVIES = [
    {
        "id": 1,
        "title": "NEO-SHADOW",
        "description": "在未來的霓虹城市中，一名失憶的駭客必須揭開自己的過去，同時對抗控制城市的邪惡企業。當真相逐漸浮現，他發現自己竟是這場陰謀的核心。一場關於身份、記憶與自由的史詩冒險即將展開。",
        "posterImage": "pic/1.png",
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
        "category": "NowShowing",
        "rating": 8.5,
        "duration": "128 分鐘",
        "ratingClass": "普遍級",
        "releaseDate": "2025/11/15"
    },
    {
        "id": 3,
        "title": "Love, Actually... Maybe?",
        "description": "當愛情遇上現實，五對戀人在聖誕節前夕面臨人生最重要的抉擇。有人選擇放手，有人選擇堅持，有人選擇重新開始。這是一個關於愛與勇氣的溫暖故事。",
        "posterImage": "pic/3.png",
        "category": "TopPick",
        "rating": 8.8,
        "duration": "118 分鐘",
        "ratingClass": "普遍級",
        "releaseDate": "2025/12/20"
    },
    {
        "id": 4,
        "title": "Echoes Of Titan",
        "description": "人類在土衛六建立的殖民地收到來自深空的神秘訊號，一支探險隊踏上未知的旅程。他們將發現，宇宙中並不只有人類，而那些「回音」背後隱藏著改變人類命運的真相。",
        "posterImage": "pic/4.png",
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
        "category": "ComingSoon",
        "rating": 9.5,
        "duration": "108 分鐘",
        "ratingClass": "普遍級",
        "releaseDate": "2025/12/25"
    },
    {
        "id": 7,
        "title": "出神入化 3",
        "description": "四騎士重出江湖，這次的對手將是前所未有的強大。當魔術與科技結合，真假難辨的世界中，誰才是真正的操控者？一場巔峰對決，即將上演。",
        "posterImage": "pic/7.jpg",
        "category": "ComingSoon",
        "rating": 8.3,
        "duration": "125 分鐘",
        "ratingClass": "保護級",
        "releaseDate": "2025/12/12"
    },
    {
        "id": 8,
        "title": "劇場版 咒術迴戰 澀谷事變×死滅迴游",
        "description": "澀谷事變的慘烈戰鬥，與死滅迴游的殘酷遊戲，即將在大銀幕上震撼呈現。虎杖悠仁與夥伴們將面對最黑暗的時刻，為了保護所愛之人而戰。",
        "posterImage": "pic/8.jpg",
        "category": "NowShowing",
        "rating": 9.4,
        "duration": "160 分鐘",
        "ratingClass": "輔15級",
        "releaseDate": "2025/12/18"
    }
];

const EMBEDDED_THEATERS = [
    { "id": 1, "name": "1廳", "totalRows": 8, "totalCols": 12 },
    { "id": 2, "name": "IMAX廳", "totalRows": 10, "totalCols": 15 },
    { "id": 3, "name": "VIP廳", "totalRows": 5, "totalCols": 8 }
];

function generateShowtimes() {
    const showtimes = [];
    const today = new Date();
    const times = ['10:30', '13:00', '15:30', '18:00', '20:30', '23:00'];
    const prices = [250, 280, 350, 300, 320, 380];
    let id = 1;

    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
        const date = new Date(today);
        date.setDate(today.getDate() + dayOffset);
        const dateStr = date.toISOString().split('T')[0];

        EMBEDDED_MOVIES.forEach((movie, movieIndex) => {
            const numShowtimes = 3 + (movieIndex % 2);
            const shuffledTimes = [...times].slice(0, numShowtimes);

            shuffledTimes.forEach((time, index) => {
                const theater = EMBEDDED_THEATERS[(movieIndex + index) % EMBEDDED_THEATERS.length];
                showtimes.push({
                    id: id++,
                    movieId: movie.id,
                    theaterId: theater.id,
                    date: dateStr,
                    time: time,
                    price: prices[(movieIndex + index) % prices.length]
                });
            });
        });
    }

    return showtimes;
}


const EMBEDDED_SHOWTIMES = generateShowtimes();

const EMBEDDED_BOOKINGS = [
    {
        "id": 1,
        "showtimeId": 1,
        "seats": [{ "row": 4, "col": 5 }, { "row": 4, "col": 6 }],
        "status": "Paid"
    },
    {
        "id": 2,
        "showtimeId": 3,
        "seats": [{ "row": 5, "col": 7 }, { "row": 5, "col": 8 }],
        "status": "Paid"
    }
];

const EMBEDDED_USERS = [
    { "id": 1, "username": "johndoe", "password": "password123", "balance": 1000.00 },
    { "id": 2, "username": "janedoe", "password": "securepass", "balance": 500.00 },
    { "id": 3, "username": "demo", "password": "demo123", "balance": 2000.00 }
];

const DataAPI = {
    CACHE_DURATION: 5 * 60 * 1000,

    cache: {
        movies: { data: null, timestamp: null },
        theaters: { data: null, timestamp: null },
        showtimes: { data: null, timestamp: null },
        bookings: { data: null, timestamp: null },
        users: { data: null, timestamp: null }
    },

    basePath: 'data/',

    useEmbeddedData: window.location.protocol === 'file:',

    /**
     * 檢查快取是否過期
     * @param {string} dataType - 資料類型
     * @returns {boolean} - 是否過期
     */
    isCacheExpired(dataType) {
        const cacheEntry = this.cache[dataType];
        if (!cacheEntry.data || !cacheEntry.timestamp) {
            return true;
        }
        return (Date.now() - cacheEntry.timestamp) > this.CACHE_DURATION;
    },

    /**
     * 通用資料載入方法
     * @param {string} dataType - 資料類型 (movies, theaters, showtimes, bookings, users)
     * @returns {Promise<Array>} - 資料陣列
     */
    async loadData(dataType) {
        if (!this.isCacheExpired(dataType)) {
            return this.cache[dataType].data;
        }

        if (this.useEmbeddedData) {
            const embeddedData = {
                movies: EMBEDDED_MOVIES,
                theaters: EMBEDDED_THEATERS,
                showtimes: EMBEDDED_SHOWTIMES,
                bookings: [...EMBEDDED_BOOKINGS, ...JSON.parse(localStorage.getItem('bookings') || '[]')],
                users: [...EMBEDDED_USERS, ...JSON.parse(localStorage.getItem('users') || '[]')]
            };
            this.cache[dataType] = { data: embeddedData[dataType], timestamp: Date.now() };
            return this.cache[dataType].data;
        }

        try {
            const response = await fetch(`${this.basePath}${dataType}.json`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            let data = await response.json();

            if (dataType === 'bookings') {
                const storedBookings = JSON.parse(localStorage.getItem('bookings') || '[]');
                data = [...data, ...storedBookings];
            } else if (dataType === 'users') {
                const storedUsers = JSON.parse(localStorage.getItem('users') || '[]');
                data = [...data, ...storedUsers];
            }

            this.cache[dataType] = { data: data, timestamp: Date.now() };
            return data;
        } catch (error) {
            console.error(`載入 ${dataType} 資料失敗:`, error);

            const embeddedData = {
                movies: EMBEDDED_MOVIES,
                theaters: EMBEDDED_THEATERS,
                showtimes: EMBEDDED_SHOWTIMES,
                bookings: [...EMBEDDED_BOOKINGS, ...JSON.parse(localStorage.getItem('bookings') || '[]')],
                users: [...EMBEDDED_USERS, ...JSON.parse(localStorage.getItem('users') || '[]')]
            };
            this.cache[dataType] = { data: embeddedData[dataType], timestamp: Date.now() };
            return this.cache[dataType].data;
        }
    },

    /**
     * 取得所有電影
     * @returns {Promise<Array>}
     */
    async getMovies() {
        return this.loadData('movies');
    },

    /**
     * 依 ID 取得電影
     * @param {number} id - 電影 ID
     * @returns {Promise<Object|null>}
     */
    async getMovieById(id) {
        const movies = await this.getMovies();
        return movies.find(m => m.id === parseInt(id)) || null;
    },

    /**
     * 依類別取得電影
     * @param {string} category - 類別 (NowShowing, TopPick, ComingSoon)
     * @returns {Promise<Array>}
     */
    async getMoviesByCategory(category) {
        const movies = await this.getMovies();
        return movies.filter(m => m.category === category);
    },

    /**
     * 取得所有影廳
     * @returns {Promise<Array>}
     */
    async getTheaters() {
        return this.loadData('theaters');
    },

    /**
     * 依 ID 取得影廳
     * @param {number} id - 影廳 ID
     * @returns {Promise<Object|null>}
     */
    async getTheaterById(id) {
        const theaters = await this.getTheaters();
        return theaters.find(t => t.id === parseInt(id)) || null;
    },

    /**
     * 取得所有場次
     * @param {Object} filters - 篩選條件 {movieId, date, theaterId}
     * @returns {Promise<Array>}
     */
    async getShowtimes(filters = {}) {
        const showtimes = await this.loadData('showtimes');
        const movies = await this.getMovies();
        const theaters = await this.getTheaters();

        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];
        const currentTime = now.toTimeString().slice(0, 5); // "HH:mm" 格式

        let results = showtimes
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

    /**
     * 依電影 ID 取得場次
     * @param {number} movieId - 電影 ID
     * @returns {Promise<Array>}
     */
    async getShowtimesByMovie(movieId) {
        return this.getShowtimes({ movieId });
    },

    /**
     * 依 ID 取得場次
     * @param {number} id - 場次 ID
     * @returns {Promise<Object|null>}
     */
    async getShowtimeById(id) {
        const showtimes = await this.getShowtimes();
        return showtimes.find(st => st.id === parseInt(id)) || null;
    },

    /**
     * 取得所有訂票記錄
     * @returns {Promise<Array>}
     */
    async getBookings() {
        return this.loadData('bookings');
    },

    /**
     * 取得指定場次的已訂座位
     * @param {number} showtimeId - 場次 ID
     * @returns {Promise<Array>} - 已訂座位陣列 [{row, col}, ...]
     */
    async getBookedSeats(showtimeId) {
        const bookings = await this.getBookings();
        const bookedSeats = [];

        bookings.forEach(booking => {
            if (booking.showtimeId === parseInt(showtimeId) && booking.status === 'Paid') {
                bookedSeats.push(...booking.seats);
            }
        });

        return bookedSeats;
    },

    /**
     * 建立訂票（模擬）
     * @param {Object} bookingData 
     * @returns {Object} 
     */
    createBooking(bookingData) {
        try {
            const storedBookings = JSON.parse(localStorage.getItem('bookings') || '[]');

            const newBooking = {
                id: Date.now(),
                showtimeId: bookingData.showtimeId,
                seats: bookingData.seats,
                movieTitle: bookingData.movieTitle || '電影票',
                moviePoster: bookingData.moviePoster || '',
                date: bookingData.date || '',
                time: bookingData.time || '',
                theaterName: bookingData.theaterName || '',
                pricePerSeat: bookingData.pricePerSeat || 0,
                status: 'Paid',
                createdAt: new Date().toISOString()
            };

            storedBookings.push(newBooking);
            localStorage.setItem('bookings', JSON.stringify(storedBookings));

            if (this.cache.bookings && this.cache.bookings.data) {
                this.cache.bookings.data.push(newBooking);
            }

            return { success: true, booking: newBooking };
        } catch (error) {
            console.error('createBooking error:', error);
            return { success: false, message: error.message };
        }
    },

    /**
     * 取得使用者
     * @param {string} username - 使用者名稱
     * @param {string} password - 密碼
     * @returns {Promise<Object|null>}
     */
    async loginUser(username, password) {
        const users = await this.loadData('users');
        const user = users.find(u => u.username === username && u.password === password);
        if (user) {
            return { id: user.id, username: user.username, balance: user.balance };
        }
        return null;
    },

    /**
     * 註冊使用者（模擬）
     * @param {string} username - 使用者名稱
     * @param {string} password - 密碼
     * @returns {Promise<Object>}
     */
    async registerUser(username, password) {
        const users = await this.loadData('users');

        if (users.find(u => u.username === username)) {
            return { success: false, message: '使用者名稱已存在' };
        }

        const newUser = {
            id: users.length + 1,
            username: username,
            password: password,
            balance: 0
        };


        const storedUsers = JSON.parse(localStorage.getItem('users') || '[]');
        storedUsers.push(newUser);
        localStorage.setItem('users', JSON.stringify(storedUsers));

        return { success: true, user: { id: newUser.id, username: newUser.username, balance: newUser.balance } };
    },

    clearCache() {
        this.cache = {
            movies: { data: null, timestamp: null },
            theaters: { data: null, timestamp: null },
            showtimes: { data: null, timestamp: null },
            bookings: { data: null, timestamp: null },
            users: { data: null, timestamp: null }
        };
    },

    /**
     * 取得未來 N 天的日期列表
     * @param {number} days - 天數（預設 5 天）
     * @returns {Array}
     */
    getNextDays(days = 5) {
        const result = [];
        const today = new Date();
        const dayNames = ['日', '一', '二', '三', '四', '五', '六'];

        for (let i = 0; i < days; i++) {
            const date = new Date(today);
            date.setDate(today.getDate() + i);
            result.push({
                dateStr: date.toISOString().split('T')[0],
                displayStr: `${date.getMonth() + 1}/${date.getDate()}`,
                dayOfWeek: dayNames[date.getDay()],
                isToday: i === 0
            });
        }

        return result;
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = DataAPI;
}
