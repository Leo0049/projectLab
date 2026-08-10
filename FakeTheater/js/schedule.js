// 電影時刻表頁面邏輯 - 使用 DataAPI 載入資料

document.addEventListener('DOMContentLoaded', async function () {
    // 頁面元素
    const dateButtonsContainer = document.getElementById('date-buttons');
    const scheduleContainer = document.getElementById('schedule-container');

    // 資料快取
    let allMovies = [];
    let allTheaters = [];
    let scheduleData = {};
    let selectedDate = '';
    let days = [];

    // 初始化
    async function init() {
        showLoading();

        try {
            // 並行載入所有資料
            [allMovies, allTheaters] = await Promise.all([
                DataAPI.getMovies(),
                DataAPI.getTheaters()
            ]);

            // 取得未來 7 天
            days = DataAPI.getNextDays(7);
            selectedDate = days[0].dateStr;

            // 建立時刻表資料結構
            await buildScheduleData();

            // 渲染日期按鈕
            renderDateButtons();

            // 渲染時刻表
            renderSchedule();

        } catch (error) {
            console.error('初始化失敗:', error);
            showError('無法載入資料，請重新整理頁面');
        }
    }

    // 建立時刻表資料
    async function buildScheduleData() {
        // 取得所有場次
        const allShowtimes = await DataAPI.getShowtimes();

        // 按日期和電影分組
        days.forEach(day => {
            scheduleData[day.dateStr] = [];

            allMovies.forEach(movie => {
                const movieSchedule = {
                    movie: movie,
                    showtimes: []
                };

                // 找到該電影在該日期的所有場次
                const movieShowtimes = allShowtimes.filter(
                    st => st.movieId === movie.id && st.date === day.dateStr
                );

                movieShowtimes.forEach(st => {
                    const theater = allTheaters.find(t => t.id === st.theaterId);
                    movieSchedule.showtimes.push({
                        id: st.id,
                        time: st.time,
                        theater: theater?.name || '未知影廳',
                        theaterId: st.theaterId,
                        price: st.price
                    });
                });

                // 按時間排序
                movieSchedule.showtimes.sort((a, b) => a.time.localeCompare(b.time));

                // 只加入有場次的電影
                if (movieSchedule.showtimes.length > 0) {
                    scheduleData[day.dateStr].push(movieSchedule);
                }
            });
        });
    }

    // 顯示載入狀態
    function showLoading() {
        if (scheduleContainer) {
            scheduleContainer.innerHTML = `
                <div class="text-center py-5">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">載入中...</span>
                    </div>
                    <p class="mt-3 text-muted">正在從資料庫載入時刻表...</p>
                </div>
            `;
        }
    }

    // 顯示錯誤
    function showError(message) {
        if (scheduleContainer) {
            scheduleContainer.innerHTML = `
                <div class="alert alert-danger">
                    <i class="fas fa-exclamation-triangle"></i> ${message}
                </div>
            `;
        }
    }

    // 渲染日期按鈕
    function renderDateButtons() {
        if (!dateButtonsContainer) return;

        dateButtonsContainer.innerHTML = days.map(day => `
            <button type="button" 
                    class="btn ${day.dateStr === selectedDate ? 'btn-primary' : 'btn-outline-primary'} date-btn me-2 mb-2"
                    data-date="${day.dateStr}">
                ${day.isToday ? '🔥 今天' : day.displayStr}<br>
                <small>週${day.dayOfWeek}</small>
            </button>
        `).join('');

        // 綁定點擊事件
        dateButtonsContainer.querySelectorAll('.date-btn').forEach(btn => {
            btn.addEventListener('click', function () {
                selectedDate = this.dataset.date;
                renderDateButtons();
                renderSchedule();
            });
        });
    }

    // 渲染時刻表
    function renderSchedule() {
        if (!scheduleContainer) return;

        const daySchedule = scheduleData[selectedDate];

        if (!daySchedule || daySchedule.length === 0) {
            scheduleContainer.innerHTML = `
                <div class="alert alert-info">
                    <i class="fas fa-info-circle"></i> 今日無場次安排
                </div>
            `;
            return;
        }

        // 顯示統計
        const totalShowtimes = daySchedule.reduce((sum, item) => sum + item.showtimes.length, 0);
        const statsHtml = `
            <div class="alert alert-light border mb-4">
                <i class="fas fa-calendar-day"></i> 
                共 <strong>${daySchedule.length}</strong> 部電影，
                <strong>${totalShowtimes}</strong> 個場次
            </div>
        `;

        scheduleContainer.innerHTML = statsHtml + daySchedule.map(item => `
            <div class="card mb-3 schedule-card">
                <div class="row g-0">
                    <div class="col-md-2 col-4 showtime-poster-col">
                        <a href="movie-detail.html?id=${item.movie.id}" class="showtime-poster-link">
                            <img src="${escapeHtml(item.movie.posterImage)}" class="showtime-poster"
                                 alt="${escapeHtml(item.movie.title)}">
                        </a>
                    </div>
                    <div class="col-md-10 col-8">
                        <div class="card-body">
                            <h5 class="card-title mb-1">
                                <a href="movie-detail.html?id=${item.movie.id}"
                                   class="text-decoration-none link-body-emphasis">${escapeHtml(item.movie.title)}</a>
                            </h5>
                            <div class="movie-meta mb-2">
                                <span class="meta-rating">⭐ ${item.movie.rating}</span>
                                <span class="meta-sep">·</span><span>${escapeHtml(item.movie.duration)}</span>
                                <span class="meta-sep">·</span><span>${escapeHtml(item.movie.ratingClass)}</span>
                                <span class="badge bg-secondary ms-1">${getCategoryLabel(item.movie.category)}</span>
                            </div>
                            <p class="card-text text-muted small mb-3 d-none d-md-block">
                                ${escapeHtml(item.movie.description?.substring(0, 100) || '')}...
                            </p>
                            <div class="showtime-slots">
                                ${item.showtimes.map(st => `
                                    <a class="showtime-slot"
                                       href="booking.html?showtime=${st.id}&movie=${item.movie.id}&date=${selectedDate}&time=${st.time}">
                                        <span class="slot-time">${st.time}</span>
                                        <span class="slot-meta">${escapeHtml(st.theater)} · NT$${st.price}</span>
                                    </a>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
    }

    // 取得類別標籤
    function getCategoryLabel(category) {
        const labels = {
            'NowShowing': '🔥 熱映中',
            'TopPick': '⭐ 強檔',
            'ComingSoon': '📢 即將上映'
        };
        return labels[category] || category;
    }

    // 初始化頁面
    await init();
});
