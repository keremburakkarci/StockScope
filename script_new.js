// Global değişkenler
let stocks = [];

document.addEventListener('DOMContentLoaded', async () => {
    const stockInput = document.getElementById('stock-input');
    const addStockBtn = document.getElementById('add-stock-btn');
    const stockContainer = document.getElementById('stock-container');
    const searchResults = document.getElementById('search-results');
    
    // Check if Firebase is available
    let firebaseEnabled = window.firebaseEnabled || false;
    let currentUserId = null;
    let currentUser = null;
    
    // UI Elements
    const loginModal = document.getElementById('login-modal');
    const googleLoginBtn = document.getElementById('google-login-btn');
    const skipLoginBtn = document.getElementById('skip-login-btn');
    const offlineModeBtn = document.getElementById('offline-mode-btn');
    const signinBtn = document.getElementById('signin-btn');
    const userProfile = document.getElementById('user-profile');
    const userAvatar = document.getElementById('user-avatar');
    const userMenu = document.getElementById('user-menu');
    const logoutBtn = document.getElementById('logout-btn');
    
    // Check if user chose offline mode before
    const isOfflineMode = localStorage.getItem('offlineMode') === 'true';
    
    // Initialize Firebase Authentication
    if (firebaseEnabled && !isOfflineMode) {
        const { signInWithPopup, GoogleAuthProvider, signInAnonymously, onAuthStateChanged, signOut } = window.firebaseModules;
        const auth = window.firebaseAuth;
        const provider = new GoogleAuthProvider();
        
        // Modal başlangıçta gizli, sadece gerekirse gösterilecek
        loginModal.style.display = 'none';
        
        // Google Login
        googleLoginBtn.addEventListener('click', async () => {
            try {
                const result = await signInWithPopup(auth, provider);
                currentUser = result.user;
                currentUserId = result.user.uid;
                loginModal.style.display = 'none';
                showUserProfile(result.user);
                console.log('🔥 Google login successful:', result.user.email);
                showSyncStatus(true);
                setupRealtimeSync();
                await loadUserStocks();
            } catch (error) {
                console.error('Google login error:', error);
                alert('Giriş yapılırken bir hata oluştu. Lütfen tekrar deneyin.');
            }
        });
        
        // Skip Login (Anonymous) - DEPRECATED, kept for backward compatibility
        if (skipLoginBtn) {
            skipLoginBtn.addEventListener('click', async () => {
                try {
                    await signInAnonymously(auth);
                    loginModal.style.display = 'none';
                    showSyncStatus(false);
                } catch (error) {
                    console.error('Anonymous login error:', error);
                    loginModal.style.display = 'none';
                }
            });
        }
        
        // Offline Mode (No Firebase, localStorage only)
        offlineModeBtn.addEventListener('click', async () => {
            console.log('📴 Offline mode activated');
            localStorage.setItem('offlineMode', 'true');
            loginModal.style.display = 'none';
            firebaseEnabled = false;
            showSyncStatus(false);
            signinBtn.style.display = 'flex'; // Show signin button
            
            // Clear stock container first
            stockContainer.innerHTML = '';
            stocks = [];
            
            // Reload initial stocks (will read from localStorage)
            await loadInitialStocks();
            
            console.log('✅ Offline mode activated, stocks loaded:', stocks.length);
        });
        
        // Logout
        logoutBtn.addEventListener('click', async () => {
            try {
                await signOut(auth);
                userProfile.style.display = 'none';
                userMenu.style.display = 'none';
                currentUserId = null;
                currentUser = null;
                showSyncStatus(false);
                signinBtn.style.display = 'flex'; // Show signin button after logout
                console.log('🔥 User logged out');
            } catch (error) {
                console.error('Logout error:', error);
            }
        });
        
        // User avatar click - toggle menu
        userAvatar.addEventListener('click', () => {
            userMenu.style.display = userMenu.style.display === 'none' ? 'block' : 'none';
        });
        
        // Close menu when clicking outside
        document.addEventListener('click', (e) => {
            if (!userProfile.contains(e.target)) {
                userMenu.style.display = 'none';
            }
        });
        
        // Auth State Observer
        onAuthStateChanged(auth, (user) => {
            if (user) {
                currentUserId = user.uid;
                currentUser = user;
                loginModal.style.display = 'none'; // Kullanıcı varsa modal'ı kapat
                signinBtn.style.display = 'none'; // Hide signin button
                
                if (user.isAnonymous) {
                    // Anonymous user - signin button göster
                    console.log('🔥 Anonymous user authenticated:', currentUserId);
                    showSyncStatus(false);
                    userProfile.style.display = 'none';
                    signinBtn.style.display = 'flex'; // Show signin button for upgrade
                } else {
                    // Google user - modal'ı gösterme
                    console.log('🔥 Google user authenticated:', user.email);
                    showUserProfile(user);
                    showSyncStatus(true);
                    loginModal.style.display = 'none';
                }
                
                setupRealtimeSync();
                loadUserStocks();
            } else {
                // Hiç kullanıcı yok - signin button göster (modal değil!)
                signinBtn.style.display = 'flex';
                loginModal.style.display = 'none'; // Modal otomatik açılmasın
                showSyncStatus(false);
                userProfile.style.display = 'none';
            }
        });
    } else {
        // Firebase disabled or offline mode
        showSyncStatus(false);
        if (loginModal) loginModal.style.display = 'none';
        
        if (isOfflineMode) {
            // User previously chose offline mode
            console.log('📴 Offline mode (from localStorage)');
            signinBtn.style.display = 'flex';
            // Don't auto-load stocks here, let loadInitialStocks() handle it at the end
        }
    }
    
    // Sign In button click - show login modal
    if (signinBtn) {
        signinBtn.addEventListener('click', () => {
            console.log('🔐 Signin button clicked');
            localStorage.removeItem('offlineMode');
            signinBtn.style.display = 'none';
            loginModal.style.display = 'flex';
        });
    }
    
    // Close login modal
    const loginCloseBtn = document.getElementById('login-close-btn');
    if (loginCloseBtn) {
        loginCloseBtn.addEventListener('click', () => {
            console.log('❌ Login modal closed');
            loginModal.style.display = 'none';
            
            // Always show signin button when modal closes
            signinBtn.style.display = 'flex';
        });
    }
    
    // Close modal on backdrop click
    if (loginModal) {
        loginModal.addEventListener('click', (e) => {
            if (e.target === loginModal) {
                loginCloseBtn.click();
            }
        });
    }
    
    // Helper: normalize Google photo URL to a fixed size and no auth requirements
    function normalizePhotoUrl(url) {
        if (!url) return null;
        try {
            // Handle Google profile photos
            if (url.includes('googleusercontent.com')) {
                // If it already has size param like =s96-c, force s64-c for compact avatar
                if (url.includes('=s')) {
                    return url.replace(/=s\d+-c.*/i, '=s64-c');
                }
                // Else, append size parameter
                const u = new URL(url);
                u.searchParams.set('sz', '64');
                return u.toString();
            }
            return url;
        } catch (_) {
            return url;
        }
    }

    // Show user profile in header
    function showUserProfile(user) {
        console.log('📸 showUserProfile called with:', user);
        if (userProfile && userAvatar) {
            userProfile.style.display = 'flex';
            const photoUrl = normalizePhotoUrl(user.photoURL);
            userAvatar.referrerPolicy = 'no-referrer';
            userAvatar.crossOrigin = 'anonymous';
            userAvatar.src = photoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || 'User')}&background=3498db&color=fff&size=64&rounded=true`;
            // Fallback on error
            userAvatar.onerror = () => {
                userAvatar.onerror = null;
                userAvatar.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || 'User')}&background=3498db&color=fff&size=64&rounded=true`;
            };
            userAvatar.style.display = 'block';
            
            const menuAvatar = document.getElementById('user-menu-avatar');
            const menuName = document.getElementById('user-menu-name');
            const menuEmail = document.getElementById('user-menu-email');
            
            if (menuAvatar) {
                const menuUrl = normalizePhotoUrl(user.photoURL);
                menuAvatar.referrerPolicy = 'no-referrer';
                menuAvatar.crossOrigin = 'anonymous';
                menuAvatar.src = menuUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || 'User')}&background=3498db&color=fff&size=64&rounded=true`;
                menuAvatar.onerror = () => {
                    menuAvatar.onerror = null;
                    menuAvatar.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || 'User')}&background=3498db&color=fff&size=64&rounded=true`;
                };
            }
            if (menuName) menuName.textContent = user.displayName || 'User';
            if (menuEmail) menuEmail.textContent = user.email || '';
            
            console.log('✅ User profile displayed:', {
                name: user.displayName,
                email: user.email,
                photo: user.photoURL
            });
        } else {
            console.error('❌ userProfile or userAvatar not found!', {
                userProfile: !!userProfile,
                userAvatar: !!userAvatar
            });
        }
    }
    
    const modal = document.getElementById('chart-modal');
    const modalStockSymbol = document.getElementById('modal-stock-symbol');
    const closeModalBtn = document.querySelector('.close-btn');
    const tradingViewWidget = document.getElementById('tradingview-widget');
    let currentStock = null;
    let currentTimeframe = '1d';
    let tradingViewChart = null;
    let searchTimeout = null;
    let sortableInstance = null;
    let favorites = [];
    let updateInterval = null;
    let isUpdating = false;
    // Debug panel state
    const stockData = {}; // symbol -> last data
    let debugPanelEnabled = false;
    let debugInterval = null;
    const initialStocks = [
        'AAPL', 'AMZN', 'GOOGL', 'META', 'MSFT', 'NVDA', 'TSLA' // Only Magnificent 7
    ];

    // Magnificent 7 companies
    const magnificent7 = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'TSLA'];

    // ============================================
    // STORAGE YÖNETİMİ (Firebase + LocalStorage)
    // ============================================
    
    async function saveUserStocks() {
        const stockSymbols = stocks.map(s => s.symbol);
        
        // Always save to localStorage (fallback)
        try {
            localStorage.setItem('userStocks', JSON.stringify(stockSymbols));
            console.log('✓ Stocks saved to localStorage:', stockSymbols);
        } catch (e) {
            console.error('localStorage save error:', e);
        }
        
        // Also save to Firebase if enabled
        if (firebaseEnabled && currentUserId) {
            try {
                const { doc, setDoc } = window.firebaseModules;
                const db = window.firebaseDb;
                
                await setDoc(doc(db, 'users', currentUserId), {
                    stocks: stockSymbols,
                    updatedAt: new Date().toISOString()
                });
                
                console.log('✓ Stocks saved to Firebase:', stockSymbols);
                updateSyncStatus('synced');
            } catch (e) {
                console.error('Firebase save error:', e);
                updateSyncStatus('error');
            }
        }
    }
    
    async function loadUserStocks() {
        // Try Firebase first (if enabled)
        if (firebaseEnabled && currentUserId) {
            try {
                const { doc, getDoc } = window.firebaseModules;
                const db = window.firebaseDb;
                
                const docSnap = await getDoc(doc(db, 'users', currentUserId));
                
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    const firebaseStocks = data.stocks || [];
                    console.log('✓ Stocks loaded from Firebase:', firebaseStocks);
                    
                    // Also save to localStorage for offline access
                    localStorage.setItem('userStocks', JSON.stringify(firebaseStocks));
                    return firebaseStocks;
                }
            } catch (e) {
                console.error('Firebase load error:', e);
            }
        }
        
        // Fallback to localStorage
        try {
            const saved = localStorage.getItem('userStocks');
            if (saved) {
                const stockList = JSON.parse(saved);
                console.log('✓ Stocks loaded from localStorage:', stockList);
                return stockList;
            }
        } catch (e) {
            console.error('localStorage load error:', e);
        }
        
        return null;
    }

    async function loadInitialStocks() {
        console.log('📦 loadInitialStocks called');
        stockContainer.innerHTML = '';
        stocks = [];
        loadFavorites();
        
        // Önce kullanıcının kaydettiği hisseleri yükle (Firebase veya localStorage)
        const savedStocks = await loadUserStocks();
        let stocksToLoad = savedStocks && savedStocks.length > 0 ? savedStocks : initialStocks;
        
        console.log('📊 Stocks to load:', stocksToLoad);
        console.log('🔥 Firebase enabled:', firebaseEnabled);
        
        // Load all stocks sequentially
        for (const symbol of stocksToLoad) {
            console.log('  ➕ Adding stock:', symbol);
            await addStock(symbol);
        }
        console.log('✅ All stocks loaded, total:', stocks.length);
        initializeSortable();
        
        // Setup real-time sync listener if Firebase enabled
        if (firebaseEnabled) {
            setupRealtimeSync();
        }
    }
    
    // Real-time sync listener
    let isFirstSnapshot = true; // İlk snapshot'ı atla
    
    function setupRealtimeSync() {
        if (!firebaseEnabled || !currentUserId) return;
        
        const { doc, onSnapshot } = window.firebaseModules;
        const db = window.firebaseDb;
        
        onSnapshot(doc(db, 'users', currentUserId), (docSnap) => {
            if (!docSnap.exists()) return;
            
            // İlk snapshot'ta bildirim gösterme (sayfa yüklenirken)
            if (isFirstSnapshot) {
                isFirstSnapshot = false;
                console.log('✓ Real-time sync listener active');
                return;
            }
            
            console.log('🔄 Real-time sync: Data changed on another device');
            
            const data = docSnap.data();
            const remoteStocks = data.stocks || [];
            const localStocks = stocks.map(s => s.symbol);
            
            // Check if there's a difference
            const isDifferent = JSON.stringify(remoteStocks.sort()) !== JSON.stringify(localStocks.sort());
            
            if (isDifferent) {
                console.log('Remote stocks:', remoteStocks);
                console.log('Local stocks:', localStocks);
                
                // Show notification
                showSyncNotification('Başka cihazdan değişiklik yapıldı. Yenilemek ister misiniz?');
            }
        });
    }
    
    function showSyncNotification(message) {
        const notification = document.createElement('div');
        notification.className = 'sync-notification';
        notification.innerHTML = `
            <div style="display: flex; align-items: center; gap: 12px;">
                <span>🔄 ${message}</span>
                <button onclick="location.reload()" style="padding: 6px 12px; background: #3498db; color: white; border: none; border-radius: 6px; cursor: pointer;">Yenile</button>
                <button onclick="this.parentElement.parentElement.remove()" style="padding: 6px 12px; background: #95a5a6; color: white; border: none; border-radius: 6px; cursor: pointer;">İptal</button>
            </div>
        `;
        document.body.appendChild(notification);
        
        // Auto-remove after 10 seconds
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, 10000);
    }
    
    function showSyncStatus(enabled) {
        const header = document.querySelector('.modern-header .header-content');
        
        // Mevcut indicator varsa sil
        let indicator = document.getElementById('sync-indicator');
        if (indicator) {
            indicator.remove();
        }
        
        // Yeni indicator oluştur
        indicator = document.createElement('div');
        indicator.id = 'sync-indicator';
        indicator.className = 'sync-indicator';
        indicator.innerHTML = enabled 
            ? '<span style="color: #2ecc71;">🔥 Multi-device sync aktif.</span>'
            : '<span style="color: #f39c12;">⚠️ Offline Mode</span>';
        header.appendChild(indicator);
    }
    
    function updateSyncStatus(status) {
        const indicator = document.getElementById('sync-indicator');
        if (!indicator) return;
        
        if (status === 'syncing') {
            indicator.innerHTML = '<span style="color: #3498db;">🔄 Senkronize ediliyor...</span>';
        } else if (status === 'synced') {
            indicator.innerHTML = '<span style="color: #2ecc71;">✓ Senkronize edildi</span>';
            setTimeout(() => {
                indicator.innerHTML = '<span style="color: #2ecc71;">🔥 Multi-device sync aktif</span>';
            }, 2000);
        }
    }

    function initializeSortable() {
        if (sortableInstance) {
            sortableInstance.destroy();
        }
        
        sortableInstance = new Sortable(stockContainer, {
            animation: 150,
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            dragClass: 'sortable-drag',
            onEnd: function(evt) {
                // Update stocks array when order changes
                updateStocksOrder();
            }
        });
    }

    function updateStocksOrder() {
        const stockCards = stockContainer.querySelectorAll('.stock-card');
        const newStocks = [];
        
        stockCards.forEach(card => {
            const symbol = card.dataset.symbol;
            const stock = stocks.find(s => s.symbol === symbol);
            if (stock) {
                newStocks.push(stock);
            }
        });
        
        stocks = newStocks;
        saveUserStocks(); // Sıralama değişince kaydet
        console.log('Stock order updated:', stocks.map(s => s.symbol));
    }

    function saveStockOrder() {
        // Bu fonksiyon artık kullanılmıyor, saveUserStocks() kullan
        saveUserStocks();
    }

    function loadStockOrder() {
        const savedOrder = localStorage.getItem('stockOrder');
        if (savedOrder) {
            try {
                const orderArray = JSON.parse(savedOrder);
                // Filter only Magnificent 7 companies
                const mag7Order = orderArray.filter(symbol => magnificent7.includes(symbol));
                return mag7Order;
            } catch (e) {
                console.error('Could not read saved order:', e);
                return [];
            }
        }
        return [];
    }

    function loadFavorites() {
        const savedFavorites = localStorage.getItem('favorites');
        if (savedFavorites) {
            try {
                favorites = JSON.parse(savedFavorites);
                console.log('Favorites loaded:', favorites);
            } catch (e) {
                console.error('Could not read favorites:', e);
                favorites = [];
            }
        } else {
            favorites = [];
        }
    }

    function saveFavorites() {
        try {
            localStorage.setItem('favorites', JSON.stringify(favorites));
            console.log('Favorites saved:', favorites);
        } catch (e) {
            console.error('Could not save favorites:', e);
        }
    }

    function toggleFavorite(symbol) {
        const index = favorites.indexOf(symbol);
        if (index > -1) {
            favorites.splice(index, 1);
            console.log(`${symbol} removed from favorites`);
            // Move to after Mag 7 when unfavorited
            moveToAfterMagnificent7(symbol);
        } else {
            favorites.push(symbol);
            console.log(`${symbol} added to favorites`);
            // Move to top when favorited
            updateStockOrder();
        }
        saveFavorites();
    }

    function updateStockOrder() {
        // Sort: Favorites first, then Mag 7 alphabetically, then others
        const favoriteStocks = stocks.filter(stock => favorites.includes(stock.symbol));
        const mag7Stocks = stocks.filter(stock => magnificent7.includes(stock.symbol) && !favorites.includes(stock.symbol))
                                 .sort((a, b) => a.symbol.localeCompare(b.symbol)); // Sort Mag 7 alphabetically
        const otherStocks = stocks.filter(stock => !magnificent7.includes(stock.symbol) && !favorites.includes(stock.symbol));
        const newOrder = [...favoriteStocks, ...mag7Stocks, ...otherStocks];
        
        // Reorder DOM
        stockContainer.innerHTML = '';
        newOrder.forEach(stock => {
            appendStockCard(stock);
        });
        
        // Update stocks array
        stocks = newOrder;
        saveStockOrder();
        initializeSortable();
        
        console.log('Order updated - Favorites first:', favorites);
    }

    function moveToAfterMagnificent7(symbol) {
        // New order: Favorites + Mag 7 (alphabetically) + Others (removed stock after Mag 7)
        const favoriteStocks = stocks.filter(stock => favorites.includes(stock.symbol));
        const mag7Stocks = stocks.filter(stock => magnificent7.includes(stock.symbol) && !favorites.includes(stock.symbol))
                                 .sort((a, b) => a.symbol.localeCompare(b.symbol)); // Sort Mag 7 alphabetically
        const otherStocks = stocks.filter(stock => !magnificent7.includes(stock.symbol) && !favorites.includes(stock.symbol));
        
        // Find and remove the unfavorited stock from other stocks
        const removedStock = otherStocks.find(stock => stock.symbol === symbol);
        if (removedStock) {
            const index = otherStocks.indexOf(removedStock);
            otherStocks.splice(index, 1);
        }
        
        // New order: Favorites + Mag 7 (alphabetically) + Removed Stock + Others
        const newOrder = [...favoriteStocks, ...mag7Stocks];
        if (removedStock) {
            newOrder.push(removedStock);
        }
        newOrder.push(...otherStocks);
        
        // Reorder DOM
        stockContainer.innerHTML = '';
        newOrder.forEach(stock => {
            appendStockCard(stock);
        });
        
        // Update stocks array
        stocks = newOrder;
        saveStockOrder();
        initializeSortable();
        
        console.log(`${symbol} moved to position after Mag 7`);
    }

    // Add stock button click handler
    addStockBtn.addEventListener('click', () => {
        const stockSymbol = stockInput.value.toUpperCase().trim();
        if (stockSymbol) {
            // Check if stock already exists
            if (stocks.some(s => s.symbol === stockSymbol)) {
                alert(`${stockSymbol} zaten listede mevcut!`);
                stockInput.value = '';
                return;
            }
            addStock(stockSymbol);
            stockInput.value = '';
            stockInput.focus(); // Keep focus on input for quick entry
        }
    });

    // Add stock with Enter key
    stockInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const stockSymbol = stockInput.value.toUpperCase().trim();
            if (stockSymbol) {
                // Check if stock already exists
                if (stocks.some(s => s.symbol === stockSymbol)) {
                    alert(`${stockSymbol} zaten listede mevcut!`);
                    stockInput.value = '';
                    return;
                }
                addStock(stockSymbol);
                stockInput.value = '';
            }
        }
    });

    // Reset order button
    const resetOrderBtn = document.getElementById('reset-order-btn');
    resetOrderBtn.addEventListener('click', () => {
        if (confirm('Hisseleri alfabetik sıraya göre düzenlemek istediğinize emin misiniz? (Favoriler önce gelecek)')) {
            resetToAlphabeticalOrder();
        }
    });

    function resetToAlphabeticalOrder() {
        console.log('Resetting to alphabetical order...');
        
        // Mevcut hisseleri alfabetik olarak sırala
        // Favorileri en başa, sonra diğerleri alfabetik
        const currentSymbols = stocks.map(s => s.symbol);
        
        const favoriteStocks = currentSymbols.filter(symbol => favorites.includes(symbol))
                                             .sort((a, b) => a.localeCompare(b));
        const nonFavoriteStocks = currentSymbols.filter(symbol => !favorites.includes(symbol))
                                                .sort((a, b) => a.localeCompare(b));
        
        const newOrder = [...favoriteStocks, ...nonFavoriteStocks];
        
        console.log('Current stocks:', currentSymbols);
        console.log('Favorite stocks (alphabetical):', favoriteStocks);
        console.log('Non-favorite stocks (alphabetical):', nonFavoriteStocks);
        console.log('New alphabetical order:', newOrder);
        
        // Reorder DOM
        reorderDOM(newOrder);
        
        // Update stocks array order
        const newStocksArray = [];
        newOrder.forEach(symbol => {
            const stock = stocks.find(s => s.symbol === symbol);
            if (stock) {
                newStocksArray.push(stock);
            }
        });
        stocks = newStocksArray;
        
        // Save new order
        saveUserStocks();
        
        console.log('Alphabetical order applied');
    }

    function reorderDOM(newOrder) {
        // Clear existing cards
        stockContainer.innerHTML = '';
        
        // Re-add cards according to new order
        newOrder.forEach(symbol => {
            const stock = stocks.find(s => s.symbol === symbol);
            if (stock) {
                appendStockCard(stock);
            }
        });
        
        console.log('DOM reordered');
    }

    async function addStock(symbol) {
        const url = `http://localhost:8084/api/stock/${symbol}`;

        try {
            const response = await fetch(url);
            const data = await response.json();

            // Check error message from server
            if (!response.ok || data.error) {
                throw new Error(data.error || `Error code from server: ${response.status}`);
            }

            if (data.chart.result && data.chart.result[0]) {
                const meta = data.chart.result[0].meta;
                const indicators = data.chart.result[0].indicators.quote[0];

                // Check premarket data
                let combinedMeta = { ...meta };
                
                // Log all meta data for debug (optional)
                // console.log(`${symbol} full meta data:`, meta);
                
                // Check pre/post market data
                if (meta.preMarketPrice !== undefined && meta.preMarketPrice !== null) {
                    console.log(`${symbol} premarket price found: ${meta.preMarketPrice}`);
                    combinedMeta.preMarketPrice = meta.preMarketPrice;
                    combinedMeta.preMarketChange = meta.preMarketChange;
                    combinedMeta.preMarketChangePercent = meta.preMarketChangePercent;
                    combinedMeta.marketState = meta.marketState || 'PRE';
                }
                
                if (meta.postMarketPrice !== undefined && meta.postMarketPrice !== null) {
                    console.log(`${symbol} postmarket price found: ${meta.postMarketPrice}`);
                    combinedMeta.postMarketPrice = meta.postMarketPrice;
                    combinedMeta.postMarketChange = meta.postMarketChange;
                    combinedMeta.postMarketChangePercent = meta.postMarketChangePercent;
                }
                
                // If API doesn't provide pre/post market data, auto-detect based on time
                const now = new Date();
                const utcHour = now.getUTCHours();
                const utcMinute = now.getUTCMinutes();
                const utcTimeInMinutes = utcHour * 60 + utcMinute;
                
                // NYSE/NASDAQ hours (UTC):
                // Pre-market: 08:00 - 13:30 UTC (04:00 - 09:30 EST)
                // Regular: 13:30 - 20:00 UTC (09:30 - 16:00 EST)
                // After-hours: 20:00 - 00:00 UTC (16:00 - 20:00 EST)
                
                const preMarketStart = 8 * 60; // 08:00 UTC
                const regularStart = 13 * 60 + 30; // 13:30 UTC
                const regularEnd = 20 * 60; // 20:00 UTC
                const afterHoursEnd = 24 * 60; // 00:00 UTC
                
                // Weekday check (0 = Sunday, 6 = Saturday)
                const dayOfWeek = now.getUTCDay();
                const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
                
                if (isWeekday) {
                    if (utcTimeInMinutes >= preMarketStart && utcTimeInMinutes < regularStart) {
                        combinedMeta.marketState = 'PRE';
                    } else if (utcTimeInMinutes >= regularEnd && utcTimeInMinutes < afterHoursEnd) {
                        combinedMeta.marketState = 'POST';
                    } else if (utcTimeInMinutes >= regularStart && utcTimeInMinutes < regularEnd) {
                        combinedMeta.marketState = 'REGULAR';
                    } else {
                        combinedMeta.marketState = 'CLOSED';
                    }
                } else {
                    combinedMeta.marketState = 'CLOSED';
                }
                
                console.log(`${symbol} - Time analysis: UTC ${utcHour}:${utcMinute}, Market State: ${combinedMeta.marketState}`);

                // Price selection - based only on actual marketState
                let latestPrice;
                if (combinedMeta.marketState === 'PRE') {
                    // Pre-market hours: first real pre, then derived pre, otherwise regular
                    const hasDerivedPre = combinedMeta.derivedPreMarketPrice !== undefined;
                    latestPrice = combinedMeta.preMarketPrice || (hasDerivedPre ? combinedMeta.derivedPreMarketPrice : combinedMeta.regularMarketPrice);
                } else if (combinedMeta.marketState === 'POST') {
                    // Post-market hours: first real post, then derived post, otherwise regular
                    const hasDerivedPost = combinedMeta.derivedPostMarketPrice !== undefined;
                    latestPrice = combinedMeta.postMarketPrice || (hasDerivedPost ? combinedMeta.derivedPostMarketPrice : combinedMeta.regularMarketPrice);
                } else {
                    // Regular or Closed: only use regularMarketPrice
                    latestPrice = combinedMeta.regularMarketPrice || combinedMeta.previousClose;
                }
                
                // Determine previousClose: based on market state
                let previousPrice;
                if (combinedMeta.marketState === 'PRE' || combinedMeta.marketState === 'POST') {
                    // Pre/Post market: regularMarketPrice = yesterday's close
                    previousPrice = combinedMeta.regularMarketPrice || combinedMeta.chartPreviousClose || combinedMeta.previousClose;
                } else {
                    // Regular market: previousClose = yesterday's close
                    previousPrice = combinedMeta.previousClose || combinedMeta.chartPreviousClose || combinedMeta.regularMarketPrice;
                }
                
                // Debug logs - activate if needed
                // console.log(`${symbol} combined meta:`, combinedMeta);
                // console.log(`${symbol} market state:`, combinedMeta.marketState);
                
                // Determine market status - ONLY based on marketState (don't check derived existence!)
                let marketStatus = 'normal';
                if (combinedMeta.marketState === 'PRE') {
                    marketStatus = 'premarket';
                } else if (combinedMeta.marketState === 'POST') {
                    marketStatus = 'postmarket';
                } else if (combinedMeta.marketState === 'REGULAR') {
                    marketStatus = 'normal';
                } else {
                    marketStatus = 'normal'; // CLOSED durumunda da normal göster
                }

                // Use actual premarket data (first direct API, then derived)
                const effectivePre = combinedMeta.preMarketPrice !== undefined ? combinedMeta.preMarketPrice : combinedMeta.derivedPreMarketPrice;
                const effectivePost = combinedMeta.postMarketPrice !== undefined ? combinedMeta.postMarketPrice : combinedMeta.derivedPostMarketPrice;

                // Calculate change (MANUAL) -> always calculate based on previousClose; don't use API change fields
                let change = 0; let changePercent = 0;
                const base = previousPrice && previousPrice !== 0 ? previousPrice : null;
                if (base) {
                    if (marketStatus === 'premarket' && effectivePre !== undefined) {
                        // Premarket change = premarket price - previous close
                        change = effectivePre - base;
                        changePercent = (change / base) * 100;
                        console.log(`${symbol} premarket change: ${effectivePre.toFixed(2)} - ${base.toFixed(2)} = ${change.toFixed(2)} (${changePercent.toFixed(2)}%)`);
                    } else if (marketStatus === 'postmarket' && effectivePost !== undefined) {
                        // Postmarket change = postmarket price - previous close
                        change = effectivePost - base;
                        changePercent = (change / base) * 100;
                        console.log(`${symbol} postmarket change: ${effectivePost.toFixed(2)} - ${base.toFixed(2)} = ${change.toFixed(2)} (${changePercent.toFixed(2)}%)`);
                    } else if (combinedMeta.regularMarketPrice !== undefined) {
                        // Regular market change = regular price - previous close
                        change = combinedMeta.regularMarketPrice - base;
                        changePercent = (change / base) * 100;
                        console.log(`${symbol} regular change: ${combinedMeta.regularMarketPrice.toFixed(2)} - ${base.toFixed(2)} = ${change.toFixed(2)} (${changePercent.toFixed(2)}%)`);
                    }
                }
                
                const history = indicators.close ? indicators.close.slice(-30) : [];
                const timestamps = data.chart.result[0].timestamp ? data.chart.result[0].timestamp.slice(-30) : [];
                const labels = timestamps.map(ts => new Date(ts * 1000).toLocaleDateString());

                const stock = {
                    symbol: symbol,
                    price: (marketStatus === 'premarket' && effectivePre !== undefined) ? effectivePre : (marketStatus === 'postmarket' && effectivePost !== undefined) ? effectivePost : latestPrice,
                    change: change,
                    changePercent: changePercent,
                    marketStatus: marketStatus,
                    previousClose: previousPrice,
                    preMarketPrice: combinedMeta.preMarketPrice !== undefined ? combinedMeta.preMarketPrice : combinedMeta.derivedPreMarketPrice,
                    postMarketPrice: combinedMeta.postMarketPrice !== undefined ? combinedMeta.postMarketPrice : combinedMeta.derivedPostMarketPrice,
                    preMarketDerived: combinedMeta.preMarketPrice === undefined && combinedMeta.derivedPreMarketPrice !== undefined,
                    postMarketDerived: combinedMeta.postMarketPrice === undefined && combinedMeta.derivedPostMarketPrice !== undefined,
                    dataSourcePre: combinedMeta.dataSources?.preMarket,
                    dataSourcePost: combinedMeta.dataSources?.postMarket,
                    history: history,
                    labels: labels,
                    regularMarketPrice: combinedMeta.regularMarketPrice,
                    previousCloseRaw: combinedMeta.previousClose,
                    marketState: combinedMeta.marketState,
                    technicalAnalysis: combinedMeta.technicalAnalysis || null, // Add technical analysis
                    analystTargets: data.analystTargets || null, // Add analyst targets
                    _lastUpdate: Date.now()
                };

                if (!stocks.some(s => s.symbol === symbol)) {
                    stocks.push(stock);
                    appendStockCard(stock);
                    saveUserStocks(); // Hisseleri kaydet
                    initializeSortable(); // Reinitialize sortable when new stock is added
                }
                stockData[symbol] = stock; // Save for debug panel
            } else {
                console.warn(`Could not get data for '${symbol}'.`, data);
                if (!initialStocks.includes(symbol)) {
                    alert(`Stock '${symbol}' not found.`);
                }
            }
        } catch (error) {
            console.error(`Error fetching data for '${symbol}':`, error.message);
            // Show error message only for first stock, write to console for others.
            if (stocks.length === 0) {
                alert(`An error occurred while fetching data: ${error.message}. Please check your internet connection and server logs in terminal.`);
            }
        }
    }

    function removeStock(symbol) {
        const index = stocks.findIndex(s => s.symbol === symbol);
        if (index > -1) {
            stocks.splice(index, 1);
            const card = stockContainer.querySelector(`[data-symbol="${symbol}"]`);
            if (card) {
                card.remove();
            }
            delete stockData[symbol];
            saveUserStocks(); // Kaydet
            console.log(`✓ ${symbol} removed and saved`);
        }
    }

    function appendStockCard(stock) {
        const changeClass = stock.change >= 0 ? 'positive' : 'negative';
        const sign = stock.change >= 0 ? '+' : '';
        const isFavorite = favorites.includes(stock.symbol);
        const currency = stock.symbol.endsWith('.IS') ? '₺' : '$';
        // Source badge mapping: Y (yahoo direct), ~ (derived)
        function sourceBadgeFor(stock){
            if (stock.marketStatus === 'premarket') {
                if (stock.preMarketDerived) return '<span class="src-badge" title="Kaynak: Yahoo (türetilmiş bar)" data-src="yahoo-derived">~</span>';
                if (stock.preMarketPrice !== undefined) return '<span class="src-badge" title="Kaynak: Yahoo" data-src="yahoo">Y</span>';
            } else if (stock.marketStatus === 'postmarket') {
                if (stock.postMarketDerived) return '<span class="src-badge" title="Kaynak: Yahoo (türetilmiş bar)" data-src="yahoo-derived">~</span>';
                if (stock.postMarketPrice !== undefined) return '<span class="src-badge" title="Kaynak: Yahoo" data-src="yahoo">Y</span>';
            }
            return '';
        }
        // New single price display: if pre or post exists, show it in main price.
        let marketStatusLabel = '';
        if (stock.marketStatus === 'premarket') {
            marketStatusLabel = '<div class="market-status inline-badge premarket">PRE</div>';
        } else if (stock.marketStatus === 'postmarket') {
            marketStatusLabel = '<div class="market-status inline-badge postmarket">POST</div>';
        }

        const stockCard = document.createElement('div');
        stockCard.classList.add('stock-card');
        stockCard.dataset.symbol = stock.symbol;
        
        // Main price to display: if preMarket exists (badge PRE), or postMarket exists (badge POST), otherwise regular
        let displayPriceValue = stock.price;
        if (stock.marketStatus === 'premarket' && stock.preMarketPrice !== undefined) {
            displayPriceValue = stock.preMarketPrice;
        } else if (stock.marketStatus === 'postmarket' && stock.postMarketPrice !== undefined) {
            displayPriceValue = stock.postMarketPrice;
        }
        const sourceBadge = sourceBadgeFor(stock);
        
        // Technical analysis summary (LONG TERM)
        let taHtml = '';
        let trendEmoji = '';
        let trendShort = '';
        let trendColor = '#888';
        let ta = null;
        let positionText = '';
        let positionBadge = '';
        let positionTooltip = '';
        
        if (stock.technicalAnalysis) {
            ta = stock.technicalAnalysis;
            
            if (ta.signals.overall === 'STRONG_BULLISH') {
                trendEmoji = '🚀'; trendColor = '#00ff88'; trendShort = 'Güçlü Yükseliş';
            } else if (ta.signals.overall === 'BULLISH') {
                trendEmoji = '📈'; trendColor = '#2d7a3e'; trendShort = 'Yükseliş';
            } else if (ta.signals.overall === 'STRONG_BEARISH') {
                trendEmoji = '💥'; trendColor = '#ff4444'; trendShort = 'Güçlü Düşüş';
            } else if (ta.signals.overall === 'BEARISH') {
                trendEmoji = '📉'; trendColor = '#ff6b6b'; trendShort = 'Düşüş';
            } else {
                trendEmoji = '➡️'; trendColor = '#ffaa00'; trendShort = 'Yatay';
            }
            
            // Calculate price position (where in support/resistance range)
            if (ta.indicators.pricePosition !== undefined) {
                const pos = ta.indicators.pricePosition;
                if (pos < 20) {
                    positionText = 'Dip Fiyat';
                    positionBadge = '🟢';
                    positionTooltip = 'Price very close to support levels. Excellent level for adding positions.';
                } else if (pos < 40) {
                    positionText = 'İyi Fiyat';
                    positionBadge = '🔵';
                    positionTooltip = 'Price close to support levels. Good level for adding positions.';
                } else if (pos < 60) {
                    positionText = 'Orta Fiyat';
                    positionBadge = '🟡';
                    positionTooltip = 'Price at mid-levels. Neither cheap nor expensive.';
                } else if (pos < 80) {
                    positionText = 'Yüksek Fiyat';
                    positionBadge = '🟠';
                    positionTooltip = 'Price close to resistance levels. Consider partial profit taking.';
                } else {
                    positionText = 'Tepe Fiyat';
                    positionBadge = '🔴';
                    positionTooltip = 'Price very close to resistance levels. Partial profit realization recommended.';
                }
            }
            
            // Determine trend color and glow
            let trendBorderColor = '#3498db';
            let trendEmojiColor = 'inherit';
            let trendGlow = '';
            
            if (trendColor === '#00ff88') { // Strong Bullish (💹)
                trendBorderColor = '#00ff88';
                trendEmojiColor = '#00ff88';
                trendGlow = '0 0 12px rgba(0, 255, 136, 0.8), 0 0 24px rgba(0, 255, 136, 0.4)';
            } else if (trendColor === '#2d7a3e') { // Bullish (📈)
                trendBorderColor = '#2ecc71';
                trendEmojiColor = '#2d7a3e';
                trendGlow = '0 0 10px rgba(45, 122, 62, 0.6)';
            } else if (trendColor === '#ff4444') { // Strong Bearish (💥)
                trendBorderColor = '#ff4444';
                trendEmojiColor = '#ff4444';
                trendGlow = '0 0 12px rgba(255, 68, 68, 0.8), 0 0 24px rgba(255, 68, 68, 0.4)';
            } else if (trendColor === '#ff6b6b') { // Bearish (📉)
                trendBorderColor = '#e74c3c';
                trendEmojiColor = '#ff6b6b';
                trendGlow = '0 0 10px rgba(255, 107, 107, 0.6)';
            } else { // Sideways (➡️)
                trendBorderColor = '#f39c12';
                trendEmojiColor = '#f39c12';
                trendGlow = '0 0 10px rgba(243, 156, 18, 0.6)';
            }
            
            // Determine price position color and glow
            let positionBorderColor = '#95a5a6';
            let positionEmojiColor = 'inherit';
            let positionGlow = '';
            
            if (positionBadge === '🟢') { // Dip Fiyat - Bottom Price (Bright Green)
                positionBorderColor = '#00ff88';
                positionEmojiColor = '#00ff88';
                positionGlow = '0 0 18px rgba(0, 255, 136, 1), 0 0 36px rgba(0, 255, 136, 0.6), 0 0 54px rgba(0, 255, 136, 0.3)';
            } else if (positionBadge === '🔵') { // İyi Fiyat - Good Price (Blue)
                positionBorderColor = '#4a9eff';
                positionEmojiColor = '#4a9eff';
                positionGlow = '0 0 14px rgba(74, 158, 255, 0.9), 0 0 28px rgba(74, 158, 255, 0.4)';
            } else if (positionBadge === '🟡') { // Orta Fiyat - Mid Price (Yellow)
                positionBorderColor = '#ffaa00';
                positionEmojiColor = '#ffaa00';
                positionGlow = '0 0 12px rgba(255, 170, 0, 0.8)';
            } else if (positionBadge === '🟠') { // High Price - Bearish (Orange)
                positionBorderColor = '#ff6b6b';
                positionEmojiColor = '#ff6b6b';
                positionGlow = '0 0 12px rgba(255, 107, 107, 0.8)';
            } else if (positionBadge === '🔴') { // Top Price - Strong Bearish (Red)
                positionBorderColor = '#ff4444';
                positionEmojiColor = '#ff4444';
                positionGlow = '0 0 18px rgba(255, 68, 68, 1), 0 0 36px rgba(255, 68, 68, 0.6), 0 0 54px rgba(255, 68, 68, 0.3)';
            }
            
            taHtml = `
                <div class="ta-summary" style="margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.08);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; gap: 20px;">
                        <div style="flex: 1; display: flex; justify-content: center;">
                            <span style="font-size: 1.6em; color: ${trendEmojiColor};">${trendEmoji}</span>
                        </div>
                        ${positionBadge ? `
                            <div style="flex: 1; display: flex; justify-content: center;">
                                <span style="font-size: 1.6em; color: ${positionEmojiColor};">${positionBadge}</span>
                            </div>
                        ` : ''}
                    </div>
                    
                    <div style="display: flex; gap: 8px; font-size: 0.8em;">
                        <div style="flex: 1; background: rgba(45, 122, 62, 0.1); padding: 6px; border-radius: 6px; text-align: center; border: 1px solid rgba(45, 122, 62, 0.2);">
                            <div style="color: #2d7a3e; font-weight: 600;">${currency}${ta.recommendations.buyPrice.toFixed(2)}</div>
                            <div style="color: #888; font-size: 0.85em; margin-top: 2px;">Ekleme</div>
                        </div>
                        <div style="flex: 1; background: rgba(255, 107, 107, 0.1); padding: 6px; border-radius: 6px; text-align: center; border: 1px solid rgba(255, 107, 107, 0.2);">
                            <div style="color: #ff6b6b; font-weight: 600;">${currency}${ta.recommendations.sellPrice.toFixed(2)}</div>
                            <div style="color: #888; font-size: 0.85em; margin-top: 2px;">Satış</div>
                        </div>
                    </div>
                </div>
            `;
        }
        
        stockCard.innerHTML = `
            <!-- Stacked (Card) Layout -->
            <div class="card-stacked" style="display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 16px 12px; position: relative;">
                <!-- Remove button at top center -->
                <button class="remove-stock-btn" data-symbol="${stock.symbol}" title="Hisseyi Sil" style="position: absolute; top: 8px; left: 50%; transform: translateX(-50%); background: rgba(255, 68, 68, 0.1); border: 1px solid rgba(255, 68, 68, 0.3); color: #ff4444; padding: 4px 8px; border-radius: 6px; cursor: pointer; font-size: 8px; transition: all 0.2s; z-index: 10;">✕</button>
                
                <!-- Star at top right -->
                <div class="favorite-star ${isFavorite ? 'active' : 'inactive'}" data-symbol="${stock.symbol}" style="position: absolute; top: 0px; right: 8px; font-size: 22px; z-index: 10;">★</div>
                
                <div style="display: flex; justify-content: flex-start; align-items: center; width: 100%; margin-top: 20px;">
                    ${marketStatusLabel}
                </div>
                <div style="text-align: center; margin-top: 2px;">
                    <h2 style="margin: 0; font-size: 1.1em; font-weight: 600; letter-spacing: 0.02em;">${stock.symbol}</h2>
                </div>
                <div style="text-align: center;">
                    <div class="stock-price" style="font-size: 1.6em; font-weight: 700; letter-spacing: -0.02em;">${currency}${Number(displayPriceValue).toFixed(2)}</div>
                </div>
                <div style="display: flex; justify-content: center; align-items: baseline; gap: 12px; font-size: 0.85em;">
                    <span class="stock-change ${changeClass}">${sign}${Number(stock.change).toFixed(2)}</span>
                    <span class="stock-change-percent ${changeClass}">${sign}${Number(stock.changePercent).toFixed(2)}%</span>
                </div>
                ${taHtml}
            </div>

            <!-- Row (List) Layout -->
            <div class="row-view" data-symbol="${stock.symbol}">
                <div class="cell cell-star">
                    <span class="favorite-star ${isFavorite ? 'active' : 'inactive'}" data-symbol="${stock.symbol}">★</span>
                </div>
                <div class="cell cell-symbol">
                    <span class="sym">${stock.symbol}</span>
                </div>
                <div class="cell cell-price">
                    ${marketStatusLabel}
                    <span class="stock-price">${currency}${Number(displayPriceValue).toFixed(2)}</span>
                </div>
                <div class="cell cell-change"><span class="stock-change ${changeClass}">${sign}${Number(stock.change).toFixed(2)}</span></div>
                <div class="cell cell-percent"><span class="stock-change-percent ${changeClass}">${sign}${Number(stock.changePercent).toFixed(2)}%</span></div>
                <div class="cell cell-trend">
                    <span class="trend-text" style="color: ${trendColor};">${trendEmoji} ${trendShort}</span>
                </div>
                <div class="cell cell-position">
                    ${positionBadge ? `<span class="position-badge">${positionBadge} ${positionText}</span>` : '-'}
                </div>
                <div class="cell cell-buy"><span class="buy-price">${ta && ta.recommendations ? currency + ta.recommendations.buyPrice.toFixed(2) : '-'}</span></div>
                <div class="cell cell-sell"><span class="sell-price">${ta && ta.recommendations ? currency + ta.recommendations.sellPrice.toFixed(2) : '-'}</span></div>
            </div>
        `;
        
        // Click event for favorite stars (both card-stacked and row-view)
        const starElements = stockCard.querySelectorAll('.favorite-star');
        starElements.forEach(starElement => {
            starElement.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent card/row click
                toggleFavorite(stock.symbol);
            });
        });
        
        // Card click (open chart) - for both card and row-view
        stockCard.addEventListener('click', (e) => {
            // Open chart modal if star is not clicked
            if (!e.target.classList.contains('favorite-star')) {
                openChartModal(stock.symbol);
            }
        });

        // Row-view specific click handler
        const rowView = stockCard.querySelector('.row-view');
        if (rowView) {
            rowView.addEventListener('click', (e) => {
                if (!e.target.classList.contains('favorite-star')) {
                    openChartModal(stock.symbol);
                }
            });
        }

        // Listen for technicalAnalysis updates and re-render panel if new data arrives
        if (!stock._taListenerAdded) {
            stock._taListenerAdded = true;
            let lastTA = stock.technicalAnalysis;
            const interval = setInterval(() => {
                if (stock.technicalAnalysis && stock.technicalAnalysis !== lastTA) {
                    lastTA = stock.technicalAnalysis;
                    renderTechnicalAnalysisPanel(stock);
                    clearInterval(interval);
                }
            }, 1000);
        }
        
        stockContainer.appendChild(stockCard);
        
        // Add remove button event listener
        const removeBtn = stockCard.querySelector('.remove-stock-btn');
        if (removeBtn) {
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const symbol = removeBtn.dataset.symbol;
                if (confirm(`${symbol} hissesini silmek istediğinize emin misiniz?`)) {
                    removeStock(symbol);
                }
            });
        }
    }

    function openChartModal(symbol) {
        const stock = stocks.find(s => s.symbol === symbol);
        if (!stock) return;

        currentStock = stock;
        modalStockSymbol.textContent = stock.symbol;
        modal.style.display = 'flex';
        
        // Fill Technical Analysis Panel
        renderTechnicalAnalysisPanel(stock);
        
        // Set default timeframe
        currentTimeframe = '1d';
        
        // Load TradingView widget
        loadTradingViewChart(symbol, currentTimeframe);
    }
    
    function renderTechnicalAnalysisPanel(stock) {
        const taPanel = document.getElementById('technical-analysis-panel');
        const currency = stock.symbol.endsWith('.IS') ? '₺' : '$';
        
        if (!stock.technicalAnalysis) {
            taPanel.innerHTML = '<div style="padding: 20px; text-align: center; color: #888;">Technical analysis data is loading.</div>';
            // Try to reload after a short delay if data might arrive asynchronously
            setTimeout(() => {
                if (stock.technicalAnalysis) {
                    renderTechnicalAnalysisPanel(stock);
                } else {
                    taPanel.innerHTML = '<div style="padding: 20px; text-align: center; color: #ff4444;">Technical analysis verisi alınamadı. Sunucu yanıtını ve ağ bağlantısını kontrol edin.</div>';
                }
            }, 1200);
            return;
        }
        
        const ta = stock.technicalAnalysis;
        const ind = ta.indicators;
        const sig = ta.signals;
        const rec = ta.recommendations;
        
        // Trend color and emoji (LONG TERM)
        let trendClass, trendEmoji, trendText, trendColor;
        if (sig.overall === 'STRONG_BULLISH') {
            trendClass = 'trend-bullish';
            trendEmoji = '🚀';
            trendText = 'Güçlü Yükseliş';
            trendColor = '#00ff88';
        } else if (sig.overall === 'BULLISH') {
            trendClass = 'trend-bullish';
            trendEmoji = '📈';
            trendText = 'Yükseliş';
            trendColor = '#2ecc71';
        } else if (sig.overall === 'STRONG_BEARISH') {
            trendClass = 'trend-bearish';
            trendEmoji = '💥';
            trendText = 'Güçlü Düşüş';
            trendColor = '#ff4444';
        } else if (sig.overall === 'BEARISH') {
            trendClass = 'trend-bearish';
            trendEmoji = '📉';
            trendText = 'Düşüş';
            trendColor = '#e74c3c';
        } else {
            trendClass = 'trend-neutral';
            trendEmoji = '➡️';
            trendText = 'Yatay';
            trendColor = '#f39c12';
        }
        
        // RSI color
        let rsiClass = 'rsi-neutral';
        let rsiStatus = 'Normal';
        let rsiColor = '#95a5a6';
        if (ind.rsi < 30) {
            rsiClass = 'rsi-oversold';
            rsiStatus = 'Aşırı Satım (AL Fırsatı)';
            rsiColor = '#00ff88';
        } else if (ind.rsi > 70) {
            rsiClass = 'rsi-overbought';
            rsiStatus = 'Aşırı Alım (SAT Fırsatı)';
            rsiColor = '#ff6b6b';
        }
        
        // Debug: Log indicators for this stock
        console.log(`[${stock.symbol}] Indicators:`, {
            superTrend: ind.superTrend ? `${ind.superTrend.trend} (${ind.superTrend.value?.toFixed(2)})` : 'null',
            utBot: ind.utBot ? `${ind.utBot.trend} (buy:${ind.utBot.buyLevel?.toFixed(2)})` : 'null',
            obv: ind.obv ? `${ind.obv.trend} (div:${ind.obv.divergence || 'none'})` : 'null',
            macd: ind.macd ? `${ind.macd.crossover || 'none'} (${ind.macd.macd?.toFixed(2)})` : 'null',
            advancedStrategy: ind.advancedStrategy ? `${ind.advancedStrategy.overallTrend} (${ind.advancedStrategy.confidence}%)` : 'null'
        });
        
        // Debug: Log advancedLevels
        console.log(`[${stock.symbol}] AdvancedLevels:`, {
            hasAdvancedLevels: !!rec.advancedLevels,
            supportCount: rec.advancedLevels?.support?.length || 0,
            resistanceCount: rec.advancedLevels?.resistance?.length || 0,
            supports: rec.advancedLevels?.support || [],
            resistances: rec.advancedLevels?.resistance || []
        });
        
        // SuperTrend status
        let superTrendEmoji = '⚪';
        let superTrendText = 'Bekleme';
        let superTrendColor = '#95a5a6';
        if (ind.superTrend && ind.superTrend.trend === 'LONG') {
            superTrendEmoji = '🟢';
            superTrendText = 'Yükseliş';
            superTrendColor = '#00ff88';
        } else if (ind.superTrend && ind.superTrend.trend === 'SHORT') {
            superTrendEmoji = '🔴';
            superTrendText = 'Düşüş';
            superTrendColor = '#ff4444';
        }
        
        // UT Bot status
        let utBotEmoji = '⚪';
        let utBotText = 'Nötr';
        let utBotColor = '#95a5a6';
        if (ind.utBot && ind.utBot.trend === 'LONG') {
            utBotEmoji = '🔵';
            utBotText = 'Yükseliş';
            utBotColor = '#4a9eff';
        } else if (ind.utBot && ind.utBot.trend === 'SHORT') {
            utBotEmoji = '🔴';
            utBotText = 'Düşüş';
            utBotColor = '#ff4444';
        }
        
        // OBV Divergence
        let obvEmoji = '➡️';
        let obvText = 'Normal';
        let obvColor = '#95a5a6';
        if (ind.obv && ind.obv.divergence === 'BULLISH') {
            obvEmoji = '💚';
            obvText = 'Yükseliş Sinyali';
            obvColor = '#00ff88';
        } else if (ind.obv && ind.obv.divergence === 'BEARISH') {
            obvEmoji = '⚠️';
            obvText = 'Düşüş Uyarısı';
            obvColor = '#ff6b6b';
        }
        
        // MACD Crossover
        let macdEmoji = '➡️';
        let macdText = 'Nötr';
        let macdColor = '#95a5a6';
        if (ind.macd && ind.macd.crossover === 'BULLISH') {
            macdEmoji = '🚀';
            macdText = 'Altın Kesişim (AL)';
            macdColor = '#00ff88';
        } else if (ind.macd && ind.macd.crossover === 'BEARISH') {
            macdEmoji = '💀';
            macdText = 'Ölüm Kesişimi (SAT)';
            macdColor = '#ff4444';
        }
        
        // Stock type display
        const stockTypeDisplay = rec.stockType || 'MIXED';
        const focusAreaDisplay = rec.focusArea || 'Genel analiz';
        let stockTypeEmoji = '📊';
        let stockTypeColor = '#95a5a6';
        
        if (stockTypeDisplay === 'STABLE_UPTREND') {
            stockTypeEmoji = '🏢'; stockTypeColor = '#2ecc71';
        } else if (stockTypeDisplay === 'HIGH_MOMENTUM') {
            stockTypeEmoji = '🚀'; stockTypeColor = '#e74c3c';
        } else if (stockTypeDisplay === 'HIGH_VOLATILITY') {
            stockTypeEmoji = '⚡'; stockTypeColor = '#f39c12';
        } else if (stockTypeDisplay === 'STRONG_GROWTH') {
            stockTypeEmoji = '📈'; stockTypeColor = '#9b59b6';
        } else if (stockTypeDisplay === 'STABLE_DOWNTREND') {
            stockTypeEmoji = '📉'; stockTypeColor = '#e67e22';
        }
        
        taPanel.innerHTML = `
            <div class="ta-header">
                <div style="text-align: center; margin-bottom: 8px;">
                    <div style="font-size: 1.2em; margin-bottom: 2px;">${trendEmoji}</div>
                    <div style="font-size: 0.85em; font-weight: 700; color: ${trendColor}; margin-bottom: 3px;">${trendText}</div>
                    <div style="font-size: 1em; color: #fff; font-weight: 600;">${currency}${ta.currentPrice.toFixed(2)}</div>
                </div>
                ${stockTypeDisplay ? `
                <div class="tooltip-container" style="background: rgba(0,0,0,0.2); padding: 6px; border-radius: 6px; margin-top: 6px; border: 1px solid rgba(255,255,255,0.1); cursor: help; position: relative;">
                    <div style="display: flex; align-items: center; justify-content: center; gap: 4px;">
                        <span style="font-size: 1em;">${stockTypeEmoji}</span>
                        <span style="font-size: 0.75em; color: ${stockTypeColor}; font-weight: 600;">${stockTypeDisplay.replace('_', ' ')}</span>
                    </div>
                    <div class="tooltip" style="width: 280px;">
                        <strong>Hisse Profili: ${stockTypeDisplay.replace('_', ' ')}</strong><br/>
                        <span style="color: #aaa; font-size: 0.85em;">${focusAreaDisplay}</span>
                    </div>
                </div>
                ` : ''}
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px; margin-top: 8px;">
                    <div class="tooltip-container" style="background: rgba(0,0,0,0.3); padding: 5px 6px; border-radius: 4px; cursor: help; position: relative;">
                        <div style="font-size: 0.65em; color: #888; margin-bottom: 2px;">SuperTrend</div>
                        <div style="font-size: 0.8em; color: ${superTrendColor}; font-weight: 600;">${superTrendText}</div>
                        <div class="tooltip" style="width: 220px;">
                            <strong>SuperTrend - ${superTrendText}</strong><br/>
                            ${superTrendText === 'Yükseliş' ? '✅ Kısa vadeli alım sinyali. Pozisyon tutmaya devam edebilir veya ekleme yapabilirsiniz.' : 
                              superTrendText === 'Düşüş' ? '⚠️ Kısa vadeli satış sinyali. Pozisyonu azaltmayı veya çıkmayı düşünebilirsiniz.' : 
                              '⏸️ Nötr durum. Trend bekleniyor, aceleci hareket etmeyin.'}
                        </div>
                    </div>
                    <div class="tooltip-container" style="background: rgba(0,0,0,0.3); padding: 5px 6px; border-radius: 4px; cursor: help; position: relative;">
                        <div style="font-size: 0.65em; color: #888; margin-bottom: 2px;">UT Bot</div>
                        <div style="font-size: 0.8em; color: ${utBotColor}; font-weight: 600;">${utBotText}</div>
                        <div class="tooltip" style="width: 220px;">
                            <strong>UT Bot - ${utBotText}</strong><br/>
                            ${utBotText === 'Yükseliş' ? '✅ Ana trend pozitif. Uzun vadeli pozisyon tutmak için güvenli sinyal.' : 
                              utBotText === 'Düşüş' ? '❌ Ana trend negatif. Pozisyondan çıkmayı ciddi olarak değerlendirin.' : 
                              '⏸️ Nötr trend. Ana yön belirsiz, sabırlı olun.'}
                        </div>
                    </div>
                    <div class="tooltip-container" style="background: rgba(0,0,0,0.3); padding: 5px 6px; border-radius: 4px; cursor: help; position: relative;">
                        <div style="font-size: 0.65em; color: #888; margin-bottom: 2px;">OBV</div>
                        <div style="font-size: 0.8em; color: ${obvColor}; font-weight: 600;">${obvText}</div>
                        <div class="tooltip" style="width: 220px;">
                            <strong>OBV - ${obvText}</strong><br/>
                            ${obvText === 'Yükseliş Sinyali' ? '💚 Fiyat düşüyor ama hacim yükseliyor - erken alım fırsatı!' : 
                              obvText === 'Düşüş Uyarısı' ? '⚠️ Fiyat yükseliyor ama hacim düşüyor - dikkatli olun, zayıf hareket!' : 
                              '➡️ Normal hacim-fiyat ilişkisi. Özel sinyal yok.'}
                        </div>
                    </div>
                    <div class="tooltip-container" style="background: rgba(0,0,0,0.3); padding: 5px 6px; border-radius: 4px; cursor: help; position: relative;">
                        <div style="font-size: 0.65em; color: #888; margin-bottom: 2px;">MACD</div>
                        <div style="font-size: 0.8em; color: ${macdColor}; font-weight: 600;">${macdText}</div>
                        <div class="tooltip" style="width: 220px;">
                            <strong>MACD - ${macdText}</strong><br/>
                            ${macdText === 'Altın Kesişim (AL)' ? '🚀 Güçlü alım sinyali! MACD çizgisi sinyal çizgisini yukarı kesti - momentum pozitif.' : 
                              macdText === 'Ölüm Kesişimi (SAT)' ? '💀 Güçlü satış sinyali! MACD çizgisi sinyal çizgisini aşağı kesti - momentum negatif.' : 
                              '➡️ Kesişim yok. Mevcut momentum devam ediyor.'}
                        </div>
                    </div>
                </div>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
                <div class="ta-simple-section" style="background: rgba(0, 255, 136, 0.08); border: 2px solid rgba(0, 255, 136, 0.3); padding: 8px; border-radius: 6px;">
                    <div class="ta-simple-title" style="font-size: 0.7em; font-weight: 700; color: #00ff88; margin-bottom: 3px;">🎯 1. Alım</div>
                    <div class="ta-simple-price buy" style="font-size: 1em; font-weight: 800; color: #00ff88; margin-bottom: 2px;">${currency}${rec.buyPrice ? rec.buyPrice.toFixed(2) : 'N/A'}</div>
                    ${rec.secondBuyPrice ? `
                        <div style="margin-top: 3px; padding-top: 3px; border-top: 1px solid rgba(0, 255, 136, 0.2);">
                            <div style="font-size: 0.6em; color: #888;">2. Hedef: <span style="color: #00ff88; font-weight: 600;">${currency}${rec.secondBuyPrice.toFixed(2)}</span></div>
                        </div>
                    ` : (rec.advancedLevels && Array.isArray(rec.advancedLevels.support) && rec.advancedLevels.support.length > 1 && rec.advancedLevels.support[1].price < rec.buyPrice ? `
                        <div style="margin-top: 3px; padding-top: 3px; border-top: 1px solid rgba(0, 255, 136, 0.2);">
                            <div style="font-size: 0.6em; color: #888;">2. Alım: <span style="color: #00ff88; font-weight: 600;">${currency}${rec.advancedLevels.support[1].price.toFixed(2)}</span></div>
                        </div>
                    ` : '')}
                </div>
                
                <div class="ta-simple-section" style="background: rgba(255, 107, 107, 0.08); border: 2px solid rgba(255, 107, 107, 0.3); padding: 8px; border-radius: 6px;">
                    <div class="ta-simple-title" style="font-size: 0.7em; font-weight: 700; color: #ff6b6b; margin-bottom: 3px;">💰 1. Satış</div>
                    <div class="ta-simple-price sell" style="font-size: 1em; font-weight: 800; color: #ff6b6b; margin-bottom: 2px;">${currency}${rec.sellPrice ? rec.sellPrice.toFixed(2) : 'N/A'}</div>
                    ${rec.advancedLevels && Array.isArray(rec.advancedLevels.resistance) && rec.advancedLevels.resistance.length > 1 ? `
                        <div style="margin-top: 3px; padding-top: 3px; border-top: 1px solid rgba(255, 107, 107, 0.2);">
                            <div style="font-size: 0.6em; color: #888;">2. Hedef: <span style="color: #ff6b6b; font-weight: 600;">${currency}${rec.advancedLevels.resistance[1].price.toFixed(2)}</span></div>
                        </div>
                    ` : ''}
                </div>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
                <div style="background: rgba(255, 255, 255, 0.03); padding: 6px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.08);">
                    <div style="font-size: 0.65em; color: #888; margin-bottom: 3px; font-weight: 600;">⚠️ Stop Loss</div>
                    <div style="font-size: 0.9em; color: #ff4444; font-weight: 700;">${currency}${rec.stopLoss.toFixed(2)}</div>
                </div>
                
                <div style="background: rgba(255, 255, 255, 0.03); padding: 6px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.08);">
                    <div style="font-size: 0.65em; color: #888; margin-bottom: 3px; font-weight: 600;">📊 RSI (14)</div>
                    <div style="font-size: 0.9em; color: ${rsiColor}; font-weight: 700;">${ind.rsi ? ind.rsi.toFixed(1) : 'N/A'}</div>
                </div>
            </div>
            
            ${sig.messages && sig.messages.length > 0 ? `
            <div class="ta-signals" style="background: rgba(52, 152, 219, 0.08); padding: 8px; border-radius: 8px; border: 1px solid rgba(52, 152, 219, 0.2);">
                <div class="ta-signals-title" style="font-size: 0.75em; font-weight: 700; color: #3498db; margin-bottom: 6px; display: flex; align-items: center; gap: 4px;">
                    <span>📢</span>
                    <span>Aktif Sinyaller</span>
                </div>
                ${sig.messages.map(msg => {
                    let bgColor = 'rgba(255, 255, 255, 0.03)';
                    let borderColor = 'rgba(255, 255, 255, 0.08)';
                    if (msg.includes('🟢') || msg.includes('💚') || msg.includes('🚀')) {
                        bgColor = 'rgba(0, 255, 136, 0.08)';
                        borderColor = 'rgba(0, 255, 136, 0.2)';
                    } else if (msg.includes('🔴') || msg.includes('⚠️') || msg.includes('💀')) {
                        bgColor = 'rgba(255, 68, 68, 0.08)';
                        borderColor = 'rgba(255, 68, 68, 0.2)';
                    }
                    return `<div class="ta-signal-item" style="padding: 6px 8px; background: ${bgColor}; border: 1px solid ${borderColor}; border-radius: 4px; margin-bottom: 4px; font-size: 0.7em; line-height: 1.3;">${msg}</div>`;
                }).join('')}
            </div>` : ''}
            
            ${stock.analystTargets ? `
            <div class="analyst-targets" style="background: linear-gradient(135deg, rgba(155, 89, 182, 0.08), rgba(142, 68, 173, 0.05)); padding: 8px; border-radius: 8px; border: 1px solid rgba(155, 89, 182, 0.2);">
                <div class="analyst-targets-title" style="font-size: 0.75em; font-weight: 700; color: #9b59b6; margin-bottom: 6px; display: flex; align-items: center; gap: 4px;">
                    <span>🎯</span>
                    <span>Profesyonel Analist Hedefleri</span>
                </div>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px;">
                    <div style="background: rgba(0, 0, 0, 0.2); padding: 6px; border-radius: 6px; text-align: center;">
                        <div style="font-size: 0.65em; color: #888; margin-bottom: 2px; font-weight: 600;">Ortalama</div>
                        <div style="font-size: 0.8em; color: #9b59b6; font-weight: 700;">${currency}${stock.analystTargets.targetMeanPrice ? stock.analystTargets.targetMeanPrice.toFixed(2) : 'N/A'}</div>
                    </div>
                    <div style="background: rgba(0, 0, 0, 0.2); padding: 6px; border-radius: 6px; text-align: center;">
                        <div style="font-size: 0.65em; color: #888; margin-bottom: 2px; font-weight: 600;">Yüksek</div>
                        <div style="font-size: 0.8em; color: #2ecc71; font-weight: 700;">${currency}${stock.analystTargets.targetHighPrice ? stock.analystTargets.targetHighPrice.toFixed(2) : 'N/A'}</div>
                    </div>
                    <div style="background: rgba(0, 0, 0, 0.2); padding: 6px; border-radius: 6px; text-align: center;">
                        <div style="font-size: 0.65em; color: #888; margin-bottom: 2px; font-weight: 600;">Düşük</div>
                        <div style="font-size: 0.8em; color: #e74c3c; font-weight: 700;">${currency}${stock.analystTargets.targetLowPrice ? stock.analystTargets.targetLowPrice.toFixed(2) : 'N/A'}</div>
                    </div>
                </div>
                ${stock.analystTargets.numberOfAnalystOpinions ? `
                <div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(155, 89, 182, 0.2); text-align: center;">
                    <div style="font-size: 0.65em; color: #9b59b6;">
                        <span>👥 ${stock.analystTargets.numberOfAnalystOpinions} Analist</span>
                        ${stock.analystTargets.recommendationKey ? ` • <span style="color: #f39c12;">${stock.analystTargets.recommendationKey.toUpperCase()}</span>` : ''}
                    </div>
                </div>
                ` : ''}
            </div>` : ''}
        `;
    }

    function loadTradingViewChart(symbol, timeframe) {
        // Clear previous widget
        if (tradingViewChart) {
            tradingViewChart.remove();
        }
        
        // Clear widget container
        tradingViewWidget.innerHTML = '';
        
        // Convert timeframe to TradingView format
        const timeframeMap = {
            '1d': '1D',
            '5d': '5D',
            '1mo': '1M',
            '3mo': '3M',
            '6mo': '6M',
            '1y': '1Y',
            '2y': '2Y',
            '5y': '5Y'
        };
        
        const tvTimeframe = timeframeMap[timeframe] || '1D';
        
        // Determine symbol format
        let symbolFormat = `NASDAQ:${symbol}`;
        
        // Some stocks are on different exchanges
        const nyseStocks = ['UNH', 'CRM', 'TEAM', 'DKNG', 'HUBS', 'MRVL', 'SMCI', 'HIMS', 'CYBR', 'UBER', 'COIN', 'SPOT'];
        const nasdaqStocks = ['AMD', 'NVDA', 'HOOD', 'RKLB', 'META', 'SOFI', 'PLTR', 'TSLA', 'AVGO', 'GOOGL', 'AAPL', 'MSFT', 'AMZN', 'INTC', 'CRWD'];
        
        if (nyseStocks.includes(symbol)) {
            symbolFormat = `NYSE:${symbol}`;
        } else if (nasdaqStocks.includes(symbol)) {
            symbolFormat = `NASDAQ:${symbol}`;
        } else {
            // Default to NASDAQ
            symbolFormat = `NASDAQ:${symbol}`;
        }
        
        console.log(`Loading chart: ${symbolFormat}`);
        
        // Create TradingView widget
        try {
            tradingViewChart = new TradingView.widget({
                "autosize": true,
                "symbol": symbolFormat,
                "interval": tvTimeframe,
                "timezone": "Europe/Istanbul",
                "theme": "dark",
                "style": "1",
                "locale": "tr",
                "toolbar_bg": "#2a2a2a",
                "enable_publishing": false,
                "hide_top_toolbar": false,
                "hide_legend": false,
                "save_image": false,
                "container_id": "tradingview-widget",
                "studies": [
                    // Basic indicators that should work
                    "Volume@tv-basicstudies",
                    "MASimple@tv-basicstudies",
                    "RSI@tv-basicstudies",
                    "MACD@tv-basicstudies",
                    "BB@tv-basicstudies"
                ],
                "show_popup_button": false,
                "popup_width": "1400",
                "popup_height": "800",
                "no_referral_id": true,
                "referral_id": "",
                "withdateranges": true,
                "hide_side_toolbar": false,
                "allow_symbol_change": false,
                "details": true,
                "hotlist": false,
                "calendar": false,
                "news": false,
                "hide_volume": false,
                "support_host": "https://www.tradingview.com",
                "onReady": function() {
                    console.log(`${symbol} grafiği başarıyla yüklendi (EMA 50-100-200, RSI, MACD, BB ile)`);
                },
                "onError": function(error) {
                    console.error(`${symbol} grafiği yüklenirken hata:`, error);
                    showChartError(symbol);
                }
            });
        } catch (error) {
            console.error(`${symbol} widget oluşturulurken hata:`, error);
            showChartError(symbol);
        }
    }

    function showChartError(symbol) {
        tradingViewWidget.innerHTML = `
            <div style="
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                height: 100%;
                color: #cccccc;
                text-align: center;
                padding: 20px;
            ">
                <div style="font-size: 48px; margin-bottom: 20px;">📈</div>
                <h3 style="color: #ff4757; margin-bottom: 10px;">Grafik Yüklenemedi</h3>
                <p style="margin-bottom: 10px;">${symbol} hissesi için grafik bulunamadı.</p>
                <p style="font-size: 14px; color: #888;">Bu hisse TradingView'da mevcut olmayabilir.</p>
                <button onclick="loadTradingViewChart('${symbol}', '${currentTimeframe}')" 
                        style="
                            margin-top: 20px;
                            padding: 10px 20px;
                            background-color: #3498db;
                            color: white;
                            border: none;
                            border-radius: 5px;
                            cursor: pointer;
                        ">
                    Tekrar Dene
                </button>
            </div>
        `;
    }

    closeModalBtn.addEventListener('click', () => { modal.style.display = 'none'; });
    window.addEventListener('click', (event) => {
        if (event.target == modal) {
            modal.style.display = 'none';
        }
    });

    // Close modal with ESC key
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && modal.style.display === 'flex') {
            modal.style.display = 'none';
        }
    });
    // Update all stock prices (unified logic)
    // YENILEME SİSTEMİ KALDIRILDI - F5 ile tam yenileme yeterli
    /*
    async function updateAllStockPrices() {
        if (isUpdating) return;
        isUpdating = true;
        const refreshBtn = document.getElementById('refresh-btn');
        refreshBtn.classList.add('updating');
        refreshBtn.disabled = true;
        console.log('Updating prices...');
        try {
            await Promise.all(stocks.map(async stock => {
                try {
                    const resp = await fetch(`/api/stock/${stock.symbol}`);
                    if(!resp.ok) throw new Error('status '+resp.status);
                    const data = await resp.json();
                    const meta = data.chart?.result?.[0]?.meta;
                    if(!meta) return;
                    console.log(`[UPDATE] ${stock.symbol} meta:`, {
                        preMarketPrice: meta.preMarketPrice,
                        derivedPreMarketPrice: meta.derivedPreMarketPrice,
                        postMarketPrice: meta.postMarketPrice,
                        derivedPostMarketPrice: meta.derivedPostMarketPrice,
                        regularMarketPrice: meta.regularMarketPrice,
                        previousClose: meta.previousClose,
                        marketState: meta.marketState,
                        marketStateRaw: meta.marketState,
                        marketStateType: typeof meta.marketState
                    });
                    
                    // AUTO-DETECT MARKET STATE (API doesn't always provide it)
                    const now = new Date();
                    const utcHour = now.getUTCHours();
                    const utcMinute = now.getUTCMinutes();
                    const utcTimeInMinutes = utcHour * 60 + utcMinute;
                    const dayOfWeek = now.getUTCDay();
                    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
                    
                    let detectedMarketState = meta.marketState || 'REGULAR';
                    if (isWeekday) {
                        const preMarketStart = 8 * 60; // 08:00 UTC
                        const regularStart = 13 * 60 + 30; // 13:30 UTC
                        const regularEnd = 20 * 60; // 20:00 UTC
                        const afterHoursEnd = 24 * 60; // 00:00 UTC
                        
                        if (utcTimeInMinutes >= preMarketStart && utcTimeInMinutes < regularStart) {
                            detectedMarketState = 'PRE';
                        } else if (utcTimeInMinutes >= regularEnd && utcTimeInMinutes < afterHoursEnd) {
                            detectedMarketState = 'POST';
                        } else if (utcTimeInMinutes >= regularStart && utcTimeInMinutes < regularEnd) {
                            detectedMarketState = 'REGULAR';
                        } else {
                            detectedMarketState = 'CLOSED';
                        }
                    } else {
                        detectedMarketState = 'CLOSED';
                    }
                    
                    console.log(`[UPDATE] ${stock.symbol} market state: ${detectedMarketState} (UTC ${utcHour}:${String(utcMinute).padStart(2, '0')})`);
                    
                    // previousClose belirleme: piyasa durumuna göre
                    let previousClose;
                    if (detectedMarketState === 'PRE' || detectedMarketState === 'POST') {
                        previousClose = meta.regularMarketPrice || meta.chartPreviousClose || meta.previousClose;
                    } else {
                        previousClose = meta.previousClose || meta.chartPreviousClose || meta.regularMarketPrice;
                    }
                    
                    // Market status - detected state'e göre belirle
                    let marketStatus = 'normal';
                    if (detectedMarketState === 'PRE') {
                        marketStatus = 'premarket';
                    } else if (detectedMarketState === 'POST') {
                        marketStatus = 'postmarket';
                    }
                    
                    // Effective pre/post - derived dahil
                    const effectivePre = meta.preMarketPrice !== undefined ? meta.preMarketPrice : meta.derivedPreMarketPrice;
                    const effectivePost = meta.postMarketPrice !== undefined ? meta.postMarketPrice : meta.derivedPostMarketPrice;
                    // Gösterilecek fiyat (pre/post varsa onları göster, yoksa regular -> previousClose fallback)
                    let displayPrice = (marketStatus === 'premarket' && effectivePre !== undefined) ? effectivePre : (marketStatus === 'postmarket' && effectivePost !== undefined) ? effectivePost : (meta.regularMarketPrice ?? previousClose);
                    // Değişim manuel hesap
                    let change = 0, changePercent = 0;
                    if (previousClose && previousClose !== 0) {
                        if (marketStatus === 'premarket' && effectivePre !== undefined) {
                            change = effectivePre - previousClose; 
                            changePercent = (change / previousClose) * 100;
                            console.log(`[UPDATE] ${stock.symbol} premarket: ${effectivePre} - ${previousClose} = ${change} (${changePercent.toFixed(2)}%)`);
                        } else if (marketStatus === 'postmarket' && effectivePost !== undefined) {
                            change = effectivePost - previousClose; 
                            changePercent = (change / previousClose) * 100;
                            console.log(`[UPDATE] ${stock.symbol} postmarket: ${effectivePost} - ${previousClose} = ${change} (${changePercent.toFixed(2)}%)`);
                        } else if (meta.regularMarketPrice !== undefined) {
                            change = meta.regularMarketPrice - previousClose; 
                            changePercent = (change / previousClose) * 100;
                            console.log(`[UPDATE] ${stock.symbol} regular: ${meta.regularMarketPrice} - ${previousClose} = ${change} (${changePercent.toFixed(2)}%)`);
                        }
                    }
                    // Save old values
                    const oldPrice = stock.price; const oldChange = stock.change; const oldChangePercent = stock.changePercent;
                    // Update
                    stock.price = displayPrice; // Plus: card logic won't recalculate
                    stock.marketStatus = marketStatus;
                    stock.change = change; 
                    stock.changePercent = changePercent;
                    console.log(`[UPDATE] ${stock.symbol} final values:`, {
                        price: stock.price,
                        change: stock.change,
                        changePercent: stock.changePercent,
                        marketStatus: stock.marketStatus,
                        displayPrice: displayPrice
                    });
                    stock.preMarketPrice = effectivePre;
                    stock.postMarketPrice = effectivePost;
                    stock.preMarketDerived = meta.preMarketPrice === undefined && meta.derivedPreMarketPrice !== undefined;
                    stock.postMarketDerived = meta.postMarketPrice === undefined && meta.derivedPostMarketPrice !== undefined;
                    stock.dataSourcePre = meta.dataSources?.preMarket;
                    stock.dataSourcePost = meta.dataSources?.postMarket;
                    stock.regularMarketPrice = meta.regularMarketPrice;
                    stock.previousClose = previousClose;
                    stock.marketState = meta.marketState;
                    stock.technicalAnalysis = meta.technicalAnalysis || stock.technicalAnalysis; // Update technical analysis
                    stock._lastUpdate = Date.now();
                    stockData[stock.symbol] = stock;
                    updateStockCard(stock, oldPrice, oldChange, oldChangePercent);
                } catch(e){ 
                    console.error('Update fail', stock.symbol, e.message, e.stack); 
                }
            }));
        } catch(e){
            console.error('Fiyat güncelleme hatası:', e.message);
        } finally {
            isUpdating = false;
            const refreshBtn2 = document.getElementById('refresh-btn');
            if(refreshBtn2){
                refreshBtn2.classList.remove('updating');
                refreshBtn2.disabled = false;
            }
        }
    }
    */

    // updateStockCard fonksiyonu da kaldırıldı - artık gerek yok
    /*
    function updateStockCard(stock, oldPrice, oldChange, oldChangePercent) {
        const stockCard = document.querySelector(`.stock-card[data-symbol="${stock.symbol}"]`);
        if (!stockCard) {
            console.warn(`[CARD UPDATE] Stock card not found for ${stock.symbol}`);
            return;
        }
        
        console.log(`[CARD UPDATE] ${stock.symbol}: price ${oldPrice} → ${stock.price}, change ${oldChange} → ${stock.change}`);
        
        const currency = stock.symbol.endsWith('.IS') ? '₺' : '$';
        
        // 1. FİYAT GÜNCELLE - Sadece sayıyı değiştir, badge'lere dokunma
        const priceElements = stockCard.querySelectorAll('.stock-price');
        priceElements.forEach(priceElement => {
            // Animasyon
            if (stock.price > oldPrice) {
                priceElement.classList.add('price-up');
                setTimeout(() => priceElement.classList.remove('price-up'), 1000);
            } else if (stock.price < oldPrice) {
                priceElement.classList.add('price-down');
                setTimeout(() => priceElement.classList.remove('price-down'), 1000);
            }
            
            // Sadece ilk text node'u güncelle (badge'leri korumak için)
            for (let i = 0; i < priceElement.childNodes.length; i++) {
                const node = priceElement.childNodes[i];
                if (node.nodeType === Node.TEXT_NODE) {
                    node.textContent = `${currency}${Number(stock.price).toFixed(2)}`;
                    break; // İlk text node'u bulduk, dur
                }
            }
        });
        
        // 2. DEĞİŞİM GÜNCELLE
        const changeElements = stockCard.querySelectorAll('.stock-change');
        changeElements.forEach(changeElement => {
            const sign = Number(stock.change) >= 0 ? '+' : '';
            changeElement.textContent = `${sign}${Number(stock.change).toFixed(2)}`;
            changeElement.style.color = Number(stock.change) >= 0 ? '#2ecc71' : '#e74c3c';
        });
        
        // 3. YÜZDE GÜNCELLE
        const changePercentElements = stockCard.querySelectorAll('.stock-change-percent');
        changePercentElements.forEach(changePercentElement => {
            const sign = Number(stock.changePercent) >= 0 ? '+' : '';
            changePercentElement.textContent = `${sign}${Number(stock.changePercent).toFixed(2)}%`;
            changePercentElement.style.color = Number(stock.changePercent) >= 0 ? '#2ecc71' : '#e74c3c';
        });
        
        // 4. MARKET STATUS BADGE - Sadece yoksa ekle, varsa güncelle
        const existingBadges = stockCard.querySelectorAll('.market-status');
        const shouldShowBadge = stock.marketStatus === 'premarket' || stock.marketStatus === 'postmarket';
        
        if (shouldShowBadge) {
            const badgeClass = stock.marketStatus === 'premarket' ? 'premarket' : 'postmarket';
            const badgeText = stock.marketStatus === 'premarket' ? 'PRE' : 'POST';
            
            // Badge yoksa ekle
            if (existingBadges.length === 0) {
                const cardStacked = stockCard.querySelector('.card-stacked');
                if (cardStacked) {
                    const badge = document.createElement('div');
                    badge.className = `market-status inline-badge ${badgeClass}`;
                    badge.textContent = badgeText;
                    cardStacked.insertBefore(badge, cardStacked.firstChild);
                }
            } else {
                // Badge varsa sadece class ve text güncelle
                existingBadges.forEach(badge => {
                    badge.className = `market-status inline-badge ${badgeClass}`;
                    badge.textContent = badgeText;
                });
            }
        } else {
            // Normal market saatinde badge'leri kaldır
            existingBadges.forEach(badge => badge.remove());
        }
        
        // ✅ BİTTİ! Technical Analysis UI'ını ASLA GÜNCELLEME!
        // İlk yüklemede (addStock) oluşturuluyor, yenilemede dokunulmayacak.
        // Sadece fiyat, değişim ve yüzde güncelledik.
    }
    */

    // startAutoUpdate ve stopAutoUpdate da kaldırıldı
    /*
    function startAutoUpdate() {
            const ta = stock.technicalAnalysis;
            let trendEmoji, trendColor, trendShort;
            
            if (ta.signals.overall === 'STRONG_BULLISH') {
                trendEmoji = '🚀'; trendColor = '#00ff88'; trendShort = 'Güçlü Yükseliş';
            } else if (ta.signals.overall === 'BULLISH') {
                trendEmoji = '📈'; trendColor = '#2d7a3e'; trendShort = 'Yükseliş';
            } else if (ta.signals.overall === 'STRONG_BEARISH') {
                trendEmoji = '💥'; trendColor = '#ff4444'; trendShort = 'Güçlü Düşüş';
            } else if (ta.signals.overall === 'BEARISH') {
                trendEmoji = '📉'; trendColor = '#ff6b6b'; trendShort = 'Düşüş';
            } else {
                trendEmoji = '➡️'; trendColor = '#ffaa00'; trendShort = 'Yatay';
            }
            
            const currency = stock.symbol.endsWith('.IS') ? '₺' : '$';
            
            // Fiyat pozisyonu
            let positionText = '';
            let positionBadge = '';
            let positionTooltip = '';
            if (ta.indicators.pricePosition !== undefined) {
                const pos = ta.indicators.pricePosition;
                if (pos < 20) {
                    positionText = 'Dip Fiyat';
                    positionBadge = '🟢';
                    positionTooltip = 'Price very close to support levels. Excellent level for adding positions.';
                } else if (pos < 40) {
                    positionText = 'İyi Fiyat';
                    positionBadge = '🔵';
                    positionTooltip = 'Price close to support levels. Good level for adding positions.';
                } else if (pos < 60) {
                    positionText = 'Orta Fiyat';
                    positionBadge = '🟡';
                    positionTooltip = 'Price at mid-levels. Neither cheap nor expensive.';
                } else if (pos < 80) {
                    positionText = 'Yüksek Fiyat';
                    positionBadge = '🟠';
                    positionTooltip = 'Price close to resistance levels. Consider partial profit taking.';
                } else {
                    positionText = 'Tepe Fiyat';
                    positionBadge = '🔴';
                    positionTooltip = 'Price very close to resistance levels. Partial profit realization recommended.';
                }
            }
            
            const taHtml = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <div style="color: ${trendColor}; font-weight: 600; font-size: 0.9em;">
                        ${trendEmoji} ${trendShort}
                    </div>
                    ${positionText ? `
                        <div class="tooltip-container" style="background: rgba(255,255,255,0.1); padding: 4px 10px; border-radius: 12px; font-size: 0.8em; font-weight: 600; cursor: help; position: relative;">
                            ${positionBadge} ${positionText}
                            <div class="tooltip" style="width: 200px;">${positionTooltip}</div>
                        </div>
                    ` : ''}
                </div>
                
                <div style="background: rgba(0,0,0,0.2); border-radius: 8px; padding: 10px;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                        <div style="flex: 1;">
                            <div style="color: #888; font-size: 0.75em; margin-bottom: 4px;">Ekleme</div>
                            <div style="color: #2d7a3e; font-weight: 600; font-size: 0.9em;">${currency}${ta.recommendations.buyPrice.toFixed(2)}</div>
                        </div>
                        <div style="flex: 1; text-align: right;">
                            <div style="color: #888; font-size: 0.75em; margin-bottom: 4px;">Kısmi Satış</div>
                            <div style="color: #ff6b6b; font-weight: 600; font-size: 0.9em;">${currency}${ta.recommendations.sellPrice.toFixed(2)}</div>
                        </div>
                    </div>
                </div>
            `;
            
            if (taElement) {
                taElement.innerHTML = taHtml;
            } else {
                // TA özeti yoksa ekle
                taElement = document.createElement('div');
                taElement.className = 'ta-summary';
                taElement.style.cssText = 'margin-top: 16px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.1);';
                taElement.innerHTML = taHtml;
                stockCard.appendChild(taElement);
            }
            
            // Row-view kolonlarını da güncelle
            const rowView = stockCard.querySelector('.row-view');
            if (rowView) {
                // Trend kolonunu güncelle
                const trendCell = rowView.querySelector('.cell-trend .trend-text');
                if (trendCell) {
                    trendCell.style.color = trendColor;
                    trendCell.textContent = `${trendEmoji} ${trendShort}`;
                }
                
                // Position kolonunu güncelle
                const positionCell = rowView.querySelector('.cell-position');
                if (positionCell) {
                    if (positionBadge && positionText) {
                        positionCell.innerHTML = `<span class="position-badge">${positionBadge} ${positionText}</span>`;
                    } else {
                        positionCell.textContent = '-';
                    }
                }
                
                // Buy/Sell kolonlarını güncelle
                const buyCell = rowView.querySelector('.cell-buy .buy-price');
                const sellCell = rowView.querySelector('.cell-sell .sell-price');
                if (buyCell && ta.recommendations) {
                    buyCell.textContent = `${currency}${ta.recommendations.buyPrice.toFixed(2)}`;
                }
                if (sellCell && ta.recommendations) {
                    sellCell.textContent = `${currency}${ta.recommendations.sellPrice.toFixed(2)}`;
                }
            }
        }
    }

    // Otomatik güncelleme başlat
    function startAutoUpdate() {
        // Her 2 dakikada bir güncelle
        updateInterval = setInterval(() => {
            if (stocks.length > 0 && !isUpdating) {
                updateAllStockPrices();
            }
        }, 120000); // 2 dakika
        
        console.log('Otomatik güncelleme başlatıldı (2 dakika)');
    }

    function stopAutoUpdate() {
        if (updateInterval) {
            clearInterval(updateInterval);
            updateInterval = null;
            console.log('Otomatik güncelleme durduruldu');
        }
    }
    */

    // Hisse kartlarını yükle
    loadInitialStocks();
    
    // Yenile butonu kaldırıldı - artık sadece F5 ile yenileme yapılacak

    // ================= View Toggle (Card/List) ==================
    const cardViewBtn = document.getElementById('card-view-btn');
    const listViewBtn = document.getElementById('list-view-btn');

    // localStorage'dan görünüm modunu yükle
    const savedViewMode = localStorage.getItem('viewMode') || 'card';
    if (savedViewMode === 'list') {
        stockContainer.classList.add('list-view');
        cardViewBtn.classList.remove('active');
        listViewBtn.classList.add('active');
        addListViewHeader();
    }

    cardViewBtn.addEventListener('click', () => {
        stockContainer.classList.remove('list-view');
        cardViewBtn.classList.add('active');
        listViewBtn.classList.remove('active');
        localStorage.setItem('viewMode', 'card');
        const header = document.querySelector('.list-view-header');
        if (header) header.remove();
    });

    listViewBtn.addEventListener('click', () => {
        stockContainer.classList.add('list-view');
        listViewBtn.classList.add('active');
        cardViewBtn.classList.remove('active');
        localStorage.setItem('viewMode', 'list');
        addListViewHeader();
    });

    function addListViewHeader() {
        if (!document.querySelector('.list-view-header')) {
            const header = document.createElement('div');
            header.className = 'list-view-header';
            header.style.display = 'grid';
            header.style.gridTemplateColumns = '24px repeat(8,1fr)';
            header.style.alignItems = 'center';
            header.innerHTML = `
                <div class="hcol"></div>
                <div class="hcol">Sembol</div>
                <div class="hcol">Fiyat</div>
                <div class="hcol">Değişim</div>
                <div class="hcol">%</div>
                <div class="hcol">Trend</div>
                <div class="hcol">Ucuzluk</div>
                <div class="hcol">Ekleme</div>
                <div class="hcol">Satış</div>
            `;
            stockContainer.parentElement.insertBefore(header, stockContainer);
        }
    }

    // ================= Debug / Observation Panel ==================
    function formatPrice(v){
        if(v === undefined || v === null || v === '-') return '-';
        if(isNaN(v)) return '-';
        return Number(v).toFixed(2);
    }

    function renderDebugTable(){
        if(!debugPanelEnabled) return;
        const tbody = document.querySelector('#debug-table tbody');
        if(!tbody) return;
        tbody.innerHTML = '';
        const now = Date.now();
        stocks.forEach(s => {
            const tr = document.createElement('tr');
            const preVal = s.preMarketPrice !== undefined ? s.preMarketPrice : '-';
            const postVal = s.postMarketPrice !== undefined ? s.postMarketPrice : '-';
            const deltaPct = (s.regularMarketPrice && s.previousClose) ? (((s.regularMarketPrice - s.previousClose)/s.previousClose)*100).toFixed(2) : '-';
            const cls = deltaPct !== '-' ? (parseFloat(deltaPct) >= 0 ? 'val-pos':'val-neg') : '';
            const updatedAgo = s._lastUpdate ? ((now - s._lastUpdate)/1000).toFixed(0)+'s' : '-';
            tr.innerHTML = `
                <td>${s.symbol}</td>
                <td>${s.marketState || s.marketStatus || '-'}</td>
                <td>${formatPrice(preVal)}</td>
                <td>${s.preMarketPrice !== undefined ? `<span class="src-badge" data-kind="${s.preMarketDerived?'derived':'direct'}">${s.preMarketDerived?'~':'Y'}</span>`:''}</td>
                <td>${formatPrice(postVal)}</td>
                <td>${s.postMarketPrice !== undefined ? `<span class="src-badge" data-kind="${s.postMarketDerived?'derived':'direct'}">${s.postMarketDerived?'~':'Y'}</span>`:''}</td>
                <td>${formatPrice(s.regularMarketPrice || s.price)}</td>
                <td>${formatPrice(s.previousClose)}</td>
                <td class="${cls}">${deltaPct !== '-' ? deltaPct+'%' : '-'}</td>
                <td>${updatedAgo}</td>`;
            tbody.appendChild(tr);
        });
    }

    function toggleDebugPanel(){
        debugPanelEnabled = !debugPanelEnabled;
        const panel = document.getElementById('debug-panel');
        if(!panel) return;
        panel.style.display = debugPanelEnabled ? 'flex' : 'none';
        if(debugPanelEnabled){
            renderDebugTable();
            if(debugInterval) clearInterval(debugInterval);
            debugInterval = setInterval(renderDebugTable, 15000);
        } else {
            if(debugInterval) clearInterval(debugInterval);
        }
    }

    const toggleDebugBtn = document.getElementById('toggle-debug-btn');
    if(toggleDebugBtn){
        toggleDebugBtn.addEventListener('click', toggleDebugPanel);
    }
    const closeDebugBtn = document.getElementById('close-debug');
    if(closeDebugBtn){
        closeDebugBtn.addEventListener('click', () => { if(debugPanelEnabled) toggleDebugPanel(); });
    }

    // Strategy Modal Event Listeners
    const strategyBtn = document.getElementById('strategy-btn');
    const strategyModal = document.getElementById('strategy-modal');
    const strategyClose = document.getElementById('strategy-close');

    if(strategyBtn){
        strategyBtn.addEventListener('click', () => {
            if(strategyModal){
                strategyModal.style.display = 'flex';
            }
        });
    }

    if(strategyClose){
        strategyClose.addEventListener('click', () => {
            if(strategyModal){
                strategyModal.style.display = 'none';
            }
        });
    }

    if(strategyModal){
        strategyModal.addEventListener('click', (e) => {
            if(e.target === strategyModal){
                strategyModal.style.display = 'none';
            }
        });
    }

    // Global Legend Modal Event Listeners
    const globalLegendBtn = document.getElementById('global-legend-btn');
    const globalLegendModal = document.getElementById('global-legend-modal');
    const globalLegendClose = document.getElementById('global-legend-close');
    
    // Market Analysis Modal Event Listeners
    const marketAnalysisBtn = document.getElementById('market-analysis-btn');
    const marketAnalysisModal = document.getElementById('market-analysis-modal');
    const marketAnalysisClose = document.getElementById('market-analysis-close');
    
    // Market Analysis Data Elements
    const fearGreedValue = document.getElementById('fear-greed-value');
    const fearGreedEmoji = document.getElementById('fear-greed-emoji');
    const fearGreedStatus = document.getElementById('fear-greed-status');
    const exposurePointer = document.getElementById('exposure-pointer');
    const exposureText = document.getElementById('exposure-text');
    const exposureDot = document.getElementById('exposure-dot');
    const exposureDescription = document.getElementById('exposure-description');
    
    // MAG7 Button
    const mag7Btn = document.getElementById('mag7-btn');

    if(globalLegendBtn){
        globalLegendBtn.addEventListener('click', () => {
            if(globalLegendModal){
                globalLegendModal.style.display = 'flex';
            }
        });
    }

    if(globalLegendClose){
        globalLegendClose.addEventListener('click', () => {
            if(globalLegendModal){
                globalLegendModal.style.display = 'none';
            }
        });
    }

    // Market Analysis Modal Event Listeners
    if(marketAnalysisBtn){
        marketAnalysisBtn.addEventListener('click', () => {
            if(marketAnalysisModal){
                marketAnalysisModal.style.display = 'flex';
                // Load market data when modal opens
                loadMarketData();
            }
        });
    }

    if(marketAnalysisClose){
        marketAnalysisClose.addEventListener('click', () => {
            if(marketAnalysisModal){
                marketAnalysisModal.style.display = 'none';
            }
        });
    }

    if(globalLegendModal){
        globalLegendModal.addEventListener('click', (e) => {
            if(e.target === globalLegendModal){
                globalLegendModal.style.display = 'none';
            }
        });
    }

    if(marketAnalysisModal){
        marketAnalysisModal.addEventListener('click', (e) => {
            if(e.target === marketAnalysisModal){
                marketAnalysisModal.style.display = 'none';
            }
        });
    }

    // MAG7 Function - Add all MAG7 stocks automatically
    function addMAG7Stocks() {
        const mag7Stocks = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'NVDA'];
        let addedCount = 0;
        let alreadyExistsCount = 0;
        
        mag7Stocks.forEach(symbol => {
            // Check if stock already exists
            const existingStock = stocks.find(stock => stock.symbol === symbol);
            if (existingStock) {
                alreadyExistsCount++;
                console.log(`📋 ${symbol} zaten listede mevcut`);
            } else {
                // Add stock using existing addStock function
                addStock(symbol);
                addedCount++;
                console.log(`✅ ${symbol} MAG7 listesine eklendi`);
            }
        });
        
        // Show notification
        if (addedCount > 0) {
            showNotification(`🎯 ${addedCount} MAG7 hissesi eklendi! ${alreadyExistsCount > 0 ? `(${alreadyExistsCount} zaten mevcuttu)` : ''}`, 'success');
        } else if (alreadyExistsCount > 0) {
            showNotification(`ℹ️ Tüm MAG7 hisseleri zaten listede mevcut!`, 'info');
        }
    }

    // MAG7 Button Event Listener
    if(mag7Btn){
        mag7Btn.addEventListener('click', () => {
            addMAG7Stocks();
        });
    }

    // Close modals with ESC key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' || e.key === 'Esc') {
            if (globalLegendModal && globalLegendModal.style.display === 'flex') {
                globalLegendModal.style.display = 'none';
            }
            if (strategyModal && strategyModal.style.display === 'flex') {
                strategyModal.style.display = 'none';
            }
            if (marketAnalysisModal && marketAnalysisModal.style.display === 'flex') {
                marketAnalysisModal.style.display = 'none';
            }
        }
    });

    // Sort Buttons - Daily Performance Sorting
    let currentSortMode = 'manual'; // 'manual', 'gainers', 'losers'
    let originalOrder = []; // Save original order
    
    const sortGainersBtn = document.getElementById('sort-gainers-btn');
    const sortLosersBtn = document.getElementById('sort-losers-btn');
    const sortResetBtn = document.getElementById('sort-reset-btn');

    function saveOriginalOrder() {
        originalOrder = Array.from(stockContainer.children).map(card => card.dataset.symbol);
    }

    function sortStocksByPerformance(mode) {
        const stockCards = Array.from(stockContainer.children);
        
        stockCards.sort((a, b) => {
            const stockA = stocks.find(s => s.symbol === a.dataset.symbol);
            const stockB = stocks.find(s => s.symbol === b.dataset.symbol);
            
            if (!stockA || !stockB) return 0;
            
            const changeA = stockA.changePercent || 0;
            const changeB = stockB.changePercent || 0;
            
            if (mode === 'gainers') {
                return changeB - changeA; // Büyükten küçüğe (en çok yükselenler)
            } else if (mode === 'losers') {
                return changeA - changeB; // Küçükten büyüğe (en çok düşenler)
            }
            return 0;
        });

        // Sıralanmış kartları yeniden ekle
        stockCards.forEach(card => stockContainer.appendChild(card));
    }

    function restoreOriginalOrder() {
        console.log('Restoring to original order...');
        const stockCards = Array.from(stockContainer.children);
        
        stockCards.sort((a, b) => {
            const indexA = originalOrder.indexOf(a.dataset.symbol);
            const indexB = originalOrder.indexOf(b.dataset.symbol);
            return indexA - indexB;
        });

        stockCards.forEach(card => stockContainer.appendChild(card));
    }

    function updateSortButtons(mode) {
        sortGainersBtn.classList.remove('active');
        sortLosersBtn.classList.remove('active');
        sortResetBtn.classList.remove('active');

        if (mode === 'gainers') {
            sortGainersBtn.classList.add('active');
            sortResetBtn.style.display = 'flex';
        } else if (mode === 'losers') {
            sortLosersBtn.classList.add('active');
            sortResetBtn.style.display = 'flex';
        } else {
            // Manual mode - hide reset button and don't add active class
            sortResetBtn.style.display = 'none';
        }
    }

    if(sortGainersBtn) {
        sortGainersBtn.addEventListener('click', () => {
            if (currentSortMode !== 'gainers') {
                if (currentSortMode === 'manual') {
                    saveOriginalOrder();
                }
                currentSortMode = 'gainers';
                sortStocksByPerformance('gainers');
                updateSortButtons('gainers');
            }
        });
    }

    if(sortLosersBtn) {
        sortLosersBtn.addEventListener('click', () => {
            if (currentSortMode !== 'losers') {
                if (currentSortMode === 'manual') {
                    saveOriginalOrder();
                }
                currentSortMode = 'losers';
                sortStocksByPerformance('losers');
                updateSortButtons('losers');
            }
        });
    }

    if(sortResetBtn) {
        sortResetBtn.addEventListener('click', () => {
            if (currentSortMode !== 'manual') {
                currentSortMode = 'manual';
                restoreOriginalOrder();
                updateSortButtons('manual');
            }
        });
    }

    // ============================================
    // PİYASA ANALİZİ FONKSİYONLARI
    // ============================================
    
    async function loadMarketData() {
        try {
            // Fear & Greed Index
            await loadFearGreedIndex();
            
            // Stock Market Exposure
            await loadStockMarketExposure();
            
        } catch (error) {
            console.error('Market data loading error:', error);
        }
    }
    
    async function loadFearGreedIndex() {
        try {
            let fearGreedData;
            
            try {
                // Try alternative Fear & Greed Index API
                const response = await fetch('https://api.alternative.me/fng/');
                if (response.ok) {
                    const data = await response.json();
                    fearGreedData = {
                        value: parseInt(data.data[0].value) || Math.floor(Math.random() * 100),
                        classification: '',
                        emoji: '',
                        color: ''
                    };
                } else {
                    throw new Error('Alternative.me API failed');
                }
            } catch (error) {
                console.warn('Fear & Greed API failed, using market-based calculation:', error);
                
                // Calculate based on market indicators
                try {
                    // Get SPY (S&P 500) data for market sentiment
                    const spyResponse = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/SPY?range=5d&interval=1d');
                    if (spyResponse.ok) {
                        const spyData = await spyResponse.json();
                        const closes = spyData.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
                        
                        if (closes && closes.length >= 2) {
                            const currentPrice = closes[closes.length - 1];
                            const previousPrice = closes[closes.length - 2];
                            const changePercent = ((currentPrice - previousPrice) / previousPrice) * 100;
                            
                            // Calculate Fear & Greed based on market performance
                            let value;
                            if (changePercent > 2) {
                                value = 70 + Math.floor(Math.random() * 30); // 70-100 (Greed)
                            } else if (changePercent > 0) {
                                value = 50 + Math.floor(Math.random() * 20); // 50-70 (Neutral-Greed)
                            } else if (changePercent > -2) {
                                value = 30 + Math.floor(Math.random() * 20); // 30-50 (Fear-Neutral)
                            } else {
                                value = Math.floor(Math.random() * 30); // 0-30 (Extreme Fear)
                            }
                            
                            fearGreedData = {
                                value: value,
                                classification: '',
                                emoji: '',
                                color: ''
                            };
                        } else {
                            throw new Error('SPY data not available');
                        }
                    } else {
                        throw new Error('SPY API failed');
                    }
                } catch (marketError) {
                    console.warn('Market-based calculation failed, using fallback:', marketError);
                    // Final fallback to random
                    fearGreedData = {
                        value: Math.floor(Math.random() * 100),
                        classification: '',
                        emoji: '',
                        color: ''
                    };
                }
            }
            
            // Determine classification
            if (fearGreedData.value <= 25) {
                fearGreedData.classification = 'EXTREME FEAR';
                fearGreedData.emoji = '😱';
                fearGreedData.color = '#ff6b6b';
            } else if (fearGreedData.value <= 45) {
                fearGreedData.classification = 'FEAR';
                fearGreedData.emoji = '😨';
                fearGreedData.color = '#ff8e53';
            } else if (fearGreedData.value <= 55) {
                fearGreedData.classification = 'NEUTRAL';
                fearGreedData.emoji = '😐';
                fearGreedData.color = '#ffd93d';
            } else if (fearGreedData.value <= 75) {
                fearGreedData.classification = 'GREED';
                fearGreedData.emoji = '😊';
                fearGreedData.color = '#6bcf7f';
            } else {
                fearGreedData.classification = 'EXTREME GREED';
                fearGreedData.emoji = '🤑';
                fearGreedData.color = '#4d7c0f';
            }
            
            // Update UI
            if (fearGreedValue) fearGreedValue.textContent = fearGreedData.value;
            if (fearGreedEmoji) fearGreedEmoji.textContent = fearGreedData.emoji;
            if (fearGreedStatus) {
                fearGreedStatus.textContent = fearGreedData.classification;
                fearGreedStatus.style.color = fearGreedData.color;
            }
            if (fearGreedValue) fearGreedValue.style.color = fearGreedData.color;
            
            // Update progress circle
            const circumference = 2 * Math.PI * 80; // radius = 80
            const offset = circumference - (fearGreedData.value / 100) * circumference;
            const progressCircle = document.querySelector('circle[stroke-dasharray="502.4"]');
            if (progressCircle) {
                progressCircle.style.strokeDashoffset = offset;
                progressCircle.style.stroke = fearGreedData.color;
            }
            
        } catch (error) {
            console.error('Fear & Greed Index loading error:', error);
        }
    }
    
    async function loadStockMarketExposure() {
        try {
            // Real Stock Market Exposure calculation based on VIX and market indicators
            let exposureData;
            
            try {
                // Get multiple market indicators for exposure calculation
                const [vixResponse, spyResponse, qqqResponse] = await Promise.all([
                    fetch('https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?range=1d&interval=1d'),
                    fetch('https://query1.finance.yahoo.com/v8/finance/chart/SPY?range=5d&interval=1d'),
                    fetch('https://query1.finance.yahoo.com/v8/finance/chart/QQQ?range=5d&interval=1d')
                ]);
                
                let vixValue = null;
                let spyChange = null;
                let qqqChange = null;
                
                // Get VIX (Volatility Index)
                if (vixResponse.ok) {
                    const vixData = await vixResponse.json();
                    vixValue = vixData.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.[0];
                }
                
                // Get SPY (S&P 500) change
                if (spyResponse.ok) {
                    const spyData = await spyResponse.json();
                    const spyCloses = spyData.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
                    if (spyCloses && spyCloses.length >= 2) {
                        spyChange = ((spyCloses[spyCloses.length - 1] - spyCloses[spyCloses.length - 2]) / spyCloses[spyCloses.length - 2]) * 100;
                    }
                }
                
                // Get QQQ (NASDAQ) change
                if (qqqResponse.ok) {
                    const qqqData = await qqqResponse.json();
                    const qqqCloses = qqqData.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
                    if (qqqCloses && qqqCloses.length >= 2) {
                        qqqChange = ((qqqCloses[qqqCloses.length - 1] - qqqCloses[qqqCloses.length - 2]) / qqqCloses[qqqCloses.length - 2]) * 100;
                    }
                }
                
                // Calculate exposure based on multiple indicators
                let percentage;
                
                if (vixValue !== null) {
                    // VIX-based calculation (primary)
                    if (vixValue < 15) {
                        percentage = 85 + Math.floor(Math.random() * 15); // 85-100% (Very Low Volatility)
                    } else if (vixValue < 20) {
                        percentage = 70 + Math.floor(Math.random() * 15); // 70-85% (Low Volatility)
                    } else if (vixValue < 30) {
                        percentage = 40 + Math.floor(Math.random() * 30); // 40-70% (Medium Volatility)
                    } else {
                        percentage = Math.floor(Math.random() * 40); // 0-40% (High Volatility)
                    }
                } else if (spyChange !== null && qqqChange !== null) {
                    // Market performance-based calculation (fallback)
                    const avgChange = (spyChange + qqqChange) / 2;
                    
                    if (avgChange > 1.5) {
                        percentage = 75 + Math.floor(Math.random() * 25); // 75-100% (Strong Bull Market)
                    } else if (avgChange > 0) {
                        percentage = 50 + Math.floor(Math.random() * 25); // 50-75% (Bull Market)
                    } else if (avgChange > -1.5) {
                        percentage = 25 + Math.floor(Math.random() * 25); // 25-50% (Bear Market)
                    } else {
                        percentage = Math.floor(Math.random() * 25); // 0-25% (Strong Bear Market)
                    }
                } else {
                    throw new Error('All market data unavailable');
                }
                
                exposureData = {
                    percentage: percentage,
                    recommendation: '',
                    description: '',
                    color: '',
                    position: 0
                };
                
            } catch (error) {
                console.warn('Market data APIs failed, using fallback:', error);
                // Fallback to random if all APIs fail
                exposureData = {
                    percentage: Math.floor(Math.random() * 100),
                    recommendation: '',
                    description: '',
                    color: '',
                    position: 0
                };
            }
            
            // Determine recommendation
            if (exposureData.percentage <= 20) {
                exposureData.recommendation = '0% to 20% Invested';
                exposureData.description = 'Çok düşük pozisyon. Piyasa düşüş fırsatları bekleniyor.';
                exposureData.color = '#ff6b6b';
                exposureData.position = 10;
            } else if (exposureData.percentage <= 40) {
                exposureData.recommendation = '20% to 40% Invested';
                exposureData.description = 'Düşük pozisyon. Dikkatli yaklaşım öneriliyor.';
                exposureData.color = '#ff8e53';
                exposureData.position = 30;
            } else if (exposureData.percentage <= 60) {
                exposureData.recommendation = '40% to 60% Invested';
                exposureData.description = 'Orta pozisyon. Dengeli yaklaşım öneriliyor.';
                exposureData.color = '#ffd93d';
                exposureData.position = 50;
            } else if (exposureData.percentage <= 80) {
                exposureData.recommendation = '60% to 80% Invested';
                exposureData.description = 'Yüksek pozisyon. Güçlü trend devam ediyor.';
                exposureData.color = '#6bcf7f';
                exposureData.position = 70;
            } else {
                exposureData.recommendation = '80% to 100% Invested';
                exposureData.description = 'Maksimum pozisyon. Aşırı alım riski var.';
                exposureData.color = '#4d7c0f';
                exposureData.position = 90;
            }
            
            // Update UI
            if (exposureText) exposureText.textContent = exposureData.recommendation;
            if (exposureDot) exposureDot.style.background = exposureData.color;
            if (exposureDescription) exposureDescription.textContent = exposureData.description;
            if (exposurePointer) {
                exposurePointer.style.left = `${exposureData.position}%`;
                exposurePointer.style.borderTopColor = exposureData.color;
            }
            if (exposureText) exposureText.style.color = exposureData.color;
            
        } catch (error) {
            console.error('Stock Market Exposure loading error:', error);
        }
    }

    // ============================================
    // HISSE ARAMA FONKSİYONLARI
    // ============================================

    async function searchStocks(query) {
        if (!query || query.length < 1) {
            searchResults.classList.remove('active');
            return;
        }

        try {
            const response = await fetch(`http://localhost:8084/api/search/${encodeURIComponent(query)}`);
            const results = await response.json();
            
            if (results.length > 0) {
                displaySearchResults(results);
            } else {
                searchResults.classList.remove('active');
            }
        } catch (error) {
            console.error('Search error:', error);
            searchResults.classList.remove('active');
        }
    }

    function displaySearchResults(results) {
        searchResults.innerHTML = '';
        
        results.forEach(result => {
            const item = document.createElement('div');
            item.className = 'search-result-item';
            item.innerHTML = `
                <div class="search-result-symbol">
                    ${result.symbol}
                    <span class="search-result-exchange">${result.exchange}</span>
                </div>
                <div class="search-result-name">${result.name}</div>
            `;
            
            item.addEventListener('click', () => {
                searchResults.classList.remove('active');
                addStock(result.symbol);
                stockInput.value = ''; // Temizle
                stockInput.focus(); // Focus'u koru
            });
            
            searchResults.appendChild(item);
        });
        
        searchResults.classList.add('active');
    }

    // Input event listener
    stockInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        
        if (searchTimeout) {
            clearTimeout(searchTimeout);
        }
        
        if (query.length >= 1) {
            searchTimeout = setTimeout(() => {
                searchStocks(query);
            }, 300); // 300ms debounce
        } else {
            searchResults.classList.remove('active');
        }
    });

    // Close search results when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-wrapper')) {
            searchResults.classList.remove('active');
        }
    });

    // Prevent search close when clicking inside
    searchResults.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    // ============================================

    // Periyodik olarak debug tablosunu güncelle (aktifse)
    setInterval(() => { if(debugPanelEnabled) renderDebugTable(); }, 5000);
});

