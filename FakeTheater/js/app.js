// --- FAKE API for demonstration ---
// In a real application, this would be a backend server.
const FAKE_DB = {
    users: [
        { id: 1, username: 'test', passwordHash: 'test', balance: 100 }
    ],
    movies: [
        { id: 1, title: 'Inception', description: '...', posterImage: 'https://via.placeholder.com/150x220.png?text=Inception', category: 'NowShowing' },
        { id: 2, title: 'The Dark Knight', description: '...', posterImage: 'https://via.placeholder.com/150x220.png?text=The+Dark+Knight', category: 'NowShowing' },
        { id: 3, title: 'Interstellar', description: '...', posterImage: 'https://via.placeholder.com/150x220.png?text=Interstellar', category: 'TopPick' },
        { id: 4, title: 'Parasite', description: '...', posterImage: 'https://via.placeholder.com/150x220.png?text=Parasite', category: 'TopPick' },
        { id: 5, title: 'Dune: Part Two', description: '...', posterImage: 'https://via.placeholder.com/150x220.png?text=Dune+Part+Two', category: 'ComingSoon' },
    ],
    showtimes: [
        { id: 1, movieId: 1, theaterId: 1, startTime: '2025-12-10 18:00:00', price: 12.00 },
        { id: 2, movieId: 1, theaterId: 1, startTime: '2025-12-10 21:00:00', price: 12.00 },
        { id: 3, movieId: 2, theaterId: 2, startTime: '2025-12-11 19:00:00', price: 15.00 },
    ],
    bookings: [],
    bookingDetails: []
};

async function fakeApi(url, options) {
    const { method = 'GET', body = {} } = options || {};
    console.log('Fake API call:', url, options);

    if (url.startsWith('/api/movies')) {
        const category = new URL(url, 'http://localhost').searchParams.get('category');
        return { ok: true, json: async () => FAKE_DB.movies.filter(m => m.category === category) };
    }

    if (url === '/api/login' && method === 'POST') {
        const user = FAKE_DB.users.find(u => u.username === body.username && u.passwordHash === body.password);
        if (user) {
            return { ok: true, json: async () => ({ id: user.id, username: user.username, balance: user.balance, token: `fake-token-${user.id}` }) };
        } else {
            return { ok: false, json: async () => ({ message: 'Invalid credentials' }) };
        }
    }
    
    if (url === '/api/register' && method === 'POST') {
        if (FAKE_DB.users.some(u => u.username === body.username)) {
            return { ok: false, json: async () => ({ message: 'Username already exists' }) };
        }
        const newUser = { id: FAKE_DB.users.length + 1, ...body, balance: 0 };
        FAKE_DB.users.push(newUser);
        return { ok: true, json: async () => ({ id: newUser.id, username: newUser.username }) };
    }

    // Add more fake endpoints as needed for other features

    return { ok: false, json: async () => ({ message: 'Endpoint not faked' }) };
}
// --- END FAKE API ---


document.addEventListener('DOMContentLoaded', function() {
    handleAuth();
    const currentPage = window.location.pathname.split('/').pop();

    if (currentPage === 'index.html' || currentPage === '') {
        loadHomePage();
    } else if (currentPage === 'login.html') {
        setupLoginPage();
    } else if (currentPage === 'register.html') {
        setupRegisterPage();
    } else if (currentPage === 'profile.html') {
        setupProfilePage();
    } else if (currentPage === 'wallet.html') {
        setupWalletPage();
    }
});

function handleAuth() {
    const authNav = document.getElementById('auth-nav');
    const userInfo = JSON.parse(localStorage.getItem('userInfo'));

    if (userInfo && userInfo.token) {
        // Logged In State
        authNav.innerHTML = `
            <li class="nav-item">
                <a class="nav-link" href="wallet.html">🛒</a>
            </li>
            <li class="nav-item dropdown">
                <a class="nav-link dropdown-toggle" href="#" id="navbarDropdown" role="button" data-bs-toggle="dropdown" aria-expanded="false">
                    ${userInfo.username}
                </a>
                <ul class="dropdown-menu dropdown-menu-end" aria-labelledby="navbarDropdown">
                    <li><a class="dropdown-item" href="profile.html">My Profile</a></li>
                    <li><a class="dropdown-item" href="wallet.html">My Wallet</a></li>
                    <li><hr class="dropdown-divider"></li>
                    <li><a class="dropdown-item" href="#" id="logout-button">Logout</a></li>
                </ul>
            </li>
        `;
        const logoutButton = document.getElementById('logout-button');
        if (logoutButton) {
            logoutButton.addEventListener('click', (e) => {
                e.preventDefault();
                localStorage.removeItem('userInfo');
                window.location.href = 'index.html';
            });
        }
    } else {
        // Guest State
        authNav.innerHTML = `
            <li class="nav-item">
                <a class="nav-link" href="wallet.html">🛒</a>
            </li>
            <li class="nav-item">
                <a class="nav-link" href="login.html">Login / Register</a>
            </li>
        `;
    }
}

async function loadHomePage() {
    await loadCarousel('NowShowing', 'carousel-inner-now-showing');
    await loadMovieList('TopPick', 'movie-list-top-pick');
    await loadMovieList('ComingSoon', 'movie-list-coming-soon');
}

async function loadCarousel(category, elementId) {
    const carouselInner = document.getElementById(elementId);
    if (!carouselInner) return;
    
    // const response = await fetch(`/api/movies?category=${category}`);
    const response = await fakeApi(`/api/movies?category=${category}`);
    const movies = await response.json();

    carouselInner.innerHTML = movies.map((movie, index) => `
        <div class="carousel-item ${index === 0 ? 'active' : ''}">
            <img src="${movie.posterImage.replace('150x220', '800x400')}" class="d-block w-100" alt="${movie.title}">
            <div class="carousel-caption d-none d-md-block">
                <h5>${movie.title}</h5>
                <p>${movie.description}</p>
            </div>
        </div>
    `).join('');
}


async function loadMovieList(category, elementId) {
    const movieList = document.getElementById(elementId);
    if (!movieList) return;

    // const response = await fetch(`/api/movies?category=${category}`);
    const response = await fakeApi(`/api/movies?category=${category}`);
    const movies = await response.json();

    movieList.innerHTML = movies.map(movie => `
        <div class="col-md-3 mb-4">
            <div class="card">
                <img src="${movie.posterImage}" class="card-img-top" alt="${movie.title}">
                <div class="card-body">
                    <h5 class="card-title">${movie.title}</h5>
                    <a href="booking.html?movieId=${movie.id}" class="btn btn-primary">Book Now</a>
                </div>
            </div>
        </div>
    `).join('');
}

function setupLoginPage() {
    const loginForm = document.getElementById('login-form');
    if(loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            const errorMessage = document.getElementById('error-message');

            // const response = await fetch('/api/login', {
            const response = await fakeApi('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: { username, passwordHash: password } // In a real app, hash the password
            });

            const data = await response.json();

            if (response.ok) {
                localStorage.setItem('userInfo', JSON.stringify(data));
                window.location.href = 'index.html';
            } else {
                errorMessage.textContent = data.message;
                errorMessage.style.display = 'block';
            }
        });
    }
}

function setupRegisterPage() {
    const registerForm = document.getElementById('register-form');
    if(registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirm-password').value;
            const errorMessage = document.getElementById('error-message');

            if (password !== confirmPassword) {
                errorMessage.textContent = 'Passwords do not match.';
                errorMessage.style.display = 'block';
                return;
            }

            // const response = await fetch('/api/register', {
            const response = await fakeApi('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: { username, passwordHash: password } // In a real app, hash the password
            });

            if (response.ok) {
                window.location.href = 'login.html';
            } else {
                const data = await response.json();
                errorMessage.textContent = data.message;
                errorMessage.style.display = 'block';
            }
        });
    }
}

function setupProfilePage() {
    const userInfo = JSON.parse(localStorage.getItem('userInfo'));
    if (!userInfo) {
        window.location.href = 'login.html';
        return;
    }
    // Load user data, transactions, etc.
    // For now, it's just a placeholder
    const userBalance = document.getElementById('user-balance');
    if (userBalance) {
        userBalance.textContent = userInfo.balance.toFixed(2);
    }
}

function setupWalletPage() {
     const userInfo = JSON.parse(localStorage.getItem('userInfo'));
    if (!userInfo) {
        window.location.href = 'login.html';
        return;
    }
    // Load tickets from API
    // Placeholder content
    const unusedTickets = document.getElementById('unused-tickets');
    if(unusedTickets) {
        unusedTickets.innerHTML = `<p class="text-muted">No unused tickets found.</p>`;
    }
}
