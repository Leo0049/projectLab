
document.addEventListener('DOMContentLoaded', async function () {
    const movieList = document.getElementById('movie-list');
    const carouselInner = document.getElementById('carousel-inner');
    const carouselIndicators = document.getElementById('carousel-indicators');
    const sectionTitle = document.getElementById('section-title');

    let allMovies = [];

    // 載入電影資料
    async function loadMovies() {
        try {
            allMovies = await DataAPI.getMovies();
            renderCarousel();
            renderMovies(allMovies);
        } catch (error) {
            console.error('載入電影失敗:', error);
        }
    }

    // 渲染輪播圖
    function renderCarousel() {
        // 選擇前 3 部熱映電影作為輪播
        const featuredMovies = allMovies.filter(m => m.category === 'NowShowing').slice(0, 2);
        featuredMovies.push(...allMovies.filter(m => m.category === 'TopPick').slice(0, 2));
        featuredMovies.push(...allMovies.filter(m => m.category === 'ComingSoon').slice(0, 2));

        if (featuredMovies.length === 0) return;

        carouselIndicators.innerHTML = featuredMovies.map((_, index) => `
                    <button type="button" data-bs-target="#movieCarousel" data-bs-slide-to="${index}" 
                        ${index === 0 ? 'class="active" aria-current="true"' : ''} 
                        aria-label="Slide ${index + 1}"></button>
                `).join('');

        carouselInner.innerHTML = featuredMovies.map((movie, index) => `
                    <div class="carousel-item ${index === 0 ? 'active' : ''}">
                        <img src="${movie.hposterImage}" class="d-block w-100" alt="${movie.title}" 
                            style="filter: brightness(0.7); object-fit: fill;">
                        <div class="carousel-caption d-none d-md-block">
                            <h3>${movie.title}</h3>
                            <p>${movie.description.substring(0, 80)}...</p>
                            <a href="movie-detail.html?id=${movie.id}" class="btn btn-book">
                                立即訂票 →
                            </a>
                        </div>
                    </div>
                `).join('');
    }

    // 渲染電影列表
    function renderMovies(movies) {
        if (movies.length === 0) {
            movieList.innerHTML = `
                        <div class="col-12">
                            <div class="alert alert-info">
                                <i class="fas fa-info-circle"></i> 目前無電影資料
                            </div>
                        </div>
                    `;
            return;
        }

        movieList.innerHTML = movies.map(movie => `
                    <div class="col-md-4 col-lg-3 mb-4 container-fluid">
                        <div class="card movie-card shadow-sm h-100">
                            <div class="card-img-wrapper">
                                <span class="category-badge badge ${getCategoryBadgeClass(movie.category)}">
                                    ${getCategoryLabel(movie.category)}
                                </span>
                                <img src="${movie.posterImage}" class="card-img-top" alt="${movie.title}">
                            </div>
                            <div class="card-body d-flex flex-column">
                                <h5 class="card-title" title="${movie.title}">${movie.title}</h5>
                                <p class="card-text flex-grow-1">${movie.description.substring(0, 50)}...</p>
                                <div class="d-flex justify-content-between align-items-center mt-auto">
                                    <a href="movie-detail.html?id=${movie.id}" class="btn btn-sm btn-book">
                                        查看詳情
                                    </a>
                                    <span class="rating-badge">⭐ ${movie.rating}/10</span>
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

    // 取得類別 Badge 樣式
    function getCategoryBadgeClass(category) {
        const classes = {
            'NowShowing': 'bg-danger',
            'TopPick': 'bg-warning',
            'ComingSoon': 'bg-info'
        };
        return classes[category] || 'bg-secondary';
    }

    // 處理分類篩選
    document.querySelectorAll('#categoryTabs .nav-link').forEach(tab => {
        tab.addEventListener('click', function () {
            const category = this.dataset.category;

            // 更新標題
            const titles = {
                'all': '全部電影',
                'NowShowing': '🔥 現正熱映',
                'TopPick': '⭐ 強檔推薦',
                'ComingSoon': '📢 即將上映'
            };
            sectionTitle.textContent = titles[category] || '電影列表';

            // 篩選電影
            if (category === 'all') {
                renderMovies(allMovies);
            } else {
                const filtered = allMovies.filter(m => m.category === category);
                renderMovies(filtered);
            }
        });
    });

    // 初始載入
    await loadMovies();
});