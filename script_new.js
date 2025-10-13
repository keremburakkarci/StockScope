document.addEventListener('DOMContentLoaded', () => {
    const stockInput = document.getElementById('stock-input');
    const addStockBtn = document.getElementById('add-stock-btn');
    const stockContainer = document.getElementById('stock-container');
    
    const modal = document.getElementById('chart-modal');
    const modalStockSymbol = document.getElementById('modal-stock-symbol');
    const closeModalBtn = document.querySelector('.close-btn');
    const tradingViewWidget = document.getElementById('tradingview-widget');
    let currentStock = null;
    let currentTimeframe = '1d';
    let tradingViewChart = null;

    let stocks = [];
    let sortableInstance = null;
    let favorites = [];
    let updateInterval = null;
    let isUpdating = false;
    // Debug panel state
    const stockData = {}; // sembol -> son veriler
    let debugPanelEnabled = false;
    let debugInterval = null;
    const initialStocks = [
        'AAPL', 'AMZN', 'GOOGL', 'META', 'MSFT', 'NVDA', 'TSLA' // Sadece Magnificent 7
    ];

    // Magnificent 7 şirketleri
    const magnificent7 = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'TSLA'];

    function loadInitialStocks() {
        stockContainer.innerHTML = '';
        stocks = [];
        loadFavorites();
        
        // Kaydedilen sıralamayı yükle
        const savedOrder = loadStockOrder();
        let stocksToLoad = initialStocks;
        
        if (savedOrder && savedOrder.length > 0) {
            // Kaydedilen sıralamayı kullan, eksik olanları sona ekle - SADECE MAG7 İÇİN
            const mag7SavedOrder = savedOrder.filter(symbol => magnificent7.includes(symbol));
            const missingStocks = initialStocks.filter(symbol => !mag7SavedOrder.includes(symbol));
            stocksToLoad = [...mag7SavedOrder, ...missingStocks];
            console.log('Kaydedilen sıralama yüklendi (sadece Mag7):', mag7SavedOrder);
        }
        
        // Tüm hisseleri sırayla yükle
        async function loadAllStocks() {
            for (const symbol of stocksToLoad) {
                await addStock(symbol);
            }
            console.log('Tüm hisseler yüklendi, sıralama kaydediliyor');
            saveStockOrder();
            initializeSortable();
        }
        
        loadAllStocks();
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
                // Sıralama değiştiğinde stocks dizisini güncelle
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
        saveStockOrder(); // Sıralamayı kaydet
        console.log('Hisse sıralaması güncellendi:', stocks.map(s => s.symbol));
    }

    function saveStockOrder() {
        const stockOrder = stocks.map(stock => stock.symbol);
        try {
            localStorage.setItem('stockOrder', JSON.stringify(stockOrder));
        } catch (e) {
            console.error('Sıralama kaydedilemedi:', e);
        }
    }

    function loadStockOrder() {
        const savedOrder = localStorage.getItem('stockOrder');
        if (savedOrder) {
            try {
                const orderArray = JSON.parse(savedOrder);
                // Sadece Magnificent 7 şirketlerini filtrele
                const mag7Order = orderArray.filter(symbol => magnificent7.includes(symbol));
                return mag7Order;
            } catch (e) {
                console.error('Kaydedilen sıralama okunamadı:', e);
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
                console.log('Favoriler yüklendi:', favorites);
            } catch (e) {
                console.error('Favoriler okunamadı:', e);
                favorites = [];
            }
        } else {
            favorites = [];
        }
    }

    function saveFavorites() {
        try {
            localStorage.setItem('favorites', JSON.stringify(favorites));
            console.log('Favoriler kaydedildi:', favorites);
        } catch (e) {
            console.error('Favoriler kaydedilemedi:', e);
        }
    }

    function toggleFavorite(symbol) {
        const index = favorites.indexOf(symbol);
        if (index > -1) {
            favorites.splice(index, 1);
            console.log(`${symbol} favorilerden çıkarıldı`);
            // Favori çıkarıldığında Mag 7 sonrasına taşı
            moveToAfterMagnificent7(symbol);
        } else {
            favorites.push(symbol);
            console.log(`${symbol} favorilere eklendi`);
            // Favori eklendiğinde en başa taşı
            updateStockOrder();
        }
        saveFavorites();
    }

    function updateStockOrder() {
        // Favorileri önce, Mag 7'yi alfabetik, diğerlerini sonra sırala
        const favoriteStocks = stocks.filter(stock => favorites.includes(stock.symbol));
        const mag7Stocks = stocks.filter(stock => magnificent7.includes(stock.symbol) && !favorites.includes(stock.symbol))
                                 .sort((a, b) => a.symbol.localeCompare(b.symbol)); // Mag 7'yi alfabetik sırala
        const otherStocks = stocks.filter(stock => !magnificent7.includes(stock.symbol) && !favorites.includes(stock.symbol));
        const newOrder = [...favoriteStocks, ...mag7Stocks, ...otherStocks];
        
        // DOM'u yeniden sırala
        stockContainer.innerHTML = '';
        newOrder.forEach(stock => {
            appendStockCard(stock);
        });
        
        // stocks dizisini güncelle
        stocks = newOrder;
        saveStockOrder();
        initializeSortable();
        
        console.log('Sıralama güncellendi - Favoriler önce:', favorites);
    }

    function moveToAfterMagnificent7(symbol) {
        // Yeni sıralama: Favoriler + Mag 7 (alfabetik) + Diğerleri (çıkarılan hisse Mag 7'dan sonra)
        const favoriteStocks = stocks.filter(stock => favorites.includes(stock.symbol));
        const mag7Stocks = stocks.filter(stock => magnificent7.includes(stock.symbol) && !favorites.includes(stock.symbol))
                                 .sort((a, b) => a.symbol.localeCompare(b.symbol)); // Mag 7'yi alfabetik sırala
        const otherStocks = stocks.filter(stock => !magnificent7.includes(stock.symbol) && !favorites.includes(stock.symbol));
        
        // Çıkarılan hisseyi bul ve diğer hisselerden çıkar
        const removedStock = otherStocks.find(stock => stock.symbol === symbol);
        if (removedStock) {
            const index = otherStocks.indexOf(removedStock);
            otherStocks.splice(index, 1);
        }
        
        // Yeni sıralama: Favoriler + Mag 7 (alfabetik) + Çıkarılan Hisse + Diğerleri
        const newOrder = [...favoriteStocks, ...mag7Stocks];
        if (removedStock) {
            newOrder.push(removedStock);
        }
        newOrder.push(...otherStocks);
        
        // DOM'u yeniden sırala
        stockContainer.innerHTML = '';
        newOrder.forEach(stock => {
            appendStockCard(stock);
        });
        
        // stocks dizisini güncelle
        stocks = newOrder;
        saveStockOrder();
        initializeSortable();
        
        console.log(`${symbol} Mag 7'dan sonraki pozisyona taşındı`);
    }

    addStockBtn.addEventListener('click', () => {
        const stockSymbol = stockInput.value.toUpperCase().trim();
        if (stockSymbol) {
            addStock(stockSymbol);
            stockInput.value = '';
        }
    });

    // Sıralamayı sıfırlama butonu
    const resetOrderBtn = document.getElementById('reset-order-btn');
    resetOrderBtn.addEventListener('click', () => {
        if (confirm('Sıralamayı sıfırlamak istediğinizden emin misiniz? Bu işlem geri alınamaz.')) {
            resetToMagnificent7Order();
        }
    });

    function resetToMagnificent7Order() {
        console.log('Magnificent 7 sıralaması sıfırlanıyor...');
        
        // localStorage'ı temizle
        localStorage.removeItem('stockOrder');
        
        // Sayfayı yeniden yükle
        stockContainer.innerHTML = '';
        stocks = [];
        
        // Favori hisseleri önce, sonra Magnificent 7 (alfabetik), sonra diğerleri
        const favoriteStocks = initialStocks.filter(symbol => favorites.includes(symbol));
        const magnificent7Stocks = magnificent7.filter(symbol => !favorites.includes(symbol))
                                              .sort((a, b) => a.localeCompare(b)); // Mag 7'yi alfabetik sırala
        const otherStocks = initialStocks.filter(symbol => 
            !magnificent7.includes(symbol) && !favorites.includes(symbol)
        );
        
        const newOrder = [...favoriteStocks, ...magnificent7Stocks, ...otherStocks];
        
        console.log('Favori hisseler:', favoriteStocks);
        console.log('Magnificent 7 (favori olmayan):', magnificent7Stocks);
        console.log('Diğer hisseler:', otherStocks);
        console.log('Yeni sıralama:', newOrder);
        
        // Yeni sıralamayı yükle
        async function loadWithNewOrder() {
            for (const symbol of newOrder) {
                await addStock(symbol);
            }
            console.log('Magnificent 7 sıralaması yüklendi');
            
            // DOM'u yeniden sırala
            reorderDOM(newOrder);
            
            // stocks dizisini güncelle
            updateStocksOrder();
            
            saveStockOrder();
            initializeSortable();
        }
        
        loadWithNewOrder();
    }

    function reorderDOM(newOrder) {
        // Mevcut kartları temizle
        stockContainer.innerHTML = '';
        
        // Yeni sıralamaya göre kartları yeniden ekle
        newOrder.forEach(symbol => {
            const stock = stocks.find(s => s.symbol === symbol);
            if (stock) {
                appendStockCard(stock);
            }
        });
        
        console.log('DOM yeniden sıralandı');
    }

    async function addStock(symbol) {
        const url = `/api/stock/${symbol}`;

        try {
            const response = await fetch(url);
            const data = await response.json();

            // Sunucudan gelen hata mesajını kontrol et
            if (!response.ok || data.error) {
                throw new Error(data.error || `Sunucudan hata kodu geldi: ${response.status}`);
            }

            if (data.chart.result && data.chart.result[0]) {
                const meta = data.chart.result[0].meta;
                const indicators = data.chart.result[0].indicators.quote[0];

                // Premarket verilerini kontrol et
                let combinedMeta = { ...meta };
                
                // Debug için tüm meta verilerini logla (isteğe bağlı)
                // console.log(`${symbol} full meta data:`, meta);
                
                // Piyasa öncesi/sonrası verileri kontrol et
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
                
                // Eğer API'den pre/post market verisi gelmiyorsa, saate göre otomatik tespit yap
                const now = new Date();
                const utcHour = now.getUTCHours();
                const utcMinute = now.getUTCMinutes();
                const utcTimeInMinutes = utcHour * 60 + utcMinute;
                
                // NYSE/NASDAQ saatleri (UTC):
                // Pre-market: 08:00 - 13:30 UTC (04:00 - 09:30 EST)
                // Regular: 13:30 - 20:00 UTC (09:30 - 16:00 EST)
                // After-hours: 20:00 - 00:00 UTC (16:00 - 20:00 EST)
                
                const preMarketStart = 8 * 60; // 08:00 UTC
                const regularStart = 13 * 60 + 30; // 13:30 UTC
                const regularEnd = 20 * 60; // 20:00 UTC
                const afterHoursEnd = 24 * 60; // 00:00 UTC
                
                // Hafta içi kontrolü (0 = Pazar, 6 = Cumartesi)
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
                
                console.log(`${symbol} - Zaman analizi: UTC ${utcHour}:${utcMinute}, Market State: ${combinedMeta.marketState}`);

                // Fiyat seçimi - sadece gerçek marketState'e göre
                let latestPrice;
                if (combinedMeta.marketState === 'PRE') {
                    // Pre-market saatinde: önce gerçek pre, sonra derived pre, yoksa regular
                    const hasDerivedPre = combinedMeta.derivedPreMarketPrice !== undefined;
                    latestPrice = combinedMeta.preMarketPrice || (hasDerivedPre ? combinedMeta.derivedPreMarketPrice : combinedMeta.regularMarketPrice);
                } else if (combinedMeta.marketState === 'POST') {
                    // Post-market saatinde: önce gerçek post, sonra derived post, yoksa regular
                    const hasDerivedPost = combinedMeta.derivedPostMarketPrice !== undefined;
                    latestPrice = combinedMeta.postMarketPrice || (hasDerivedPost ? combinedMeta.derivedPostMarketPrice : combinedMeta.regularMarketPrice);
                } else {
                    // Regular veya Closed: sadece regularMarketPrice kullan
                    latestPrice = combinedMeta.regularMarketPrice || combinedMeta.previousClose;
                }
                
                // previousClose belirleme: piyasa durumuna göre
                let previousPrice;
                if (combinedMeta.marketState === 'PRE' || combinedMeta.marketState === 'POST') {
                    // Pre/Post market: regularMarketPrice = dünün kapanışı
                    previousPrice = combinedMeta.regularMarketPrice || combinedMeta.chartPreviousClose || combinedMeta.previousClose;
                } else {
                    // Regular market: previousClose = dünün kapanışı
                    previousPrice = combinedMeta.previousClose || combinedMeta.chartPreviousClose || combinedMeta.regularMarketPrice;
                }
                
                // Debug logları - gerekirse aktif et
                // console.log(`${symbol} combined meta:`, combinedMeta);
                // console.log(`${symbol} market state:`, combinedMeta.marketState);
                
                // Piyasa durumunu belirle - SADECE marketState'e göre (derived varlığına bakma!)
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

                // Gerçek premarket verilerini kullan (önce direkt API, sonra derived)
                const effectivePre = combinedMeta.preMarketPrice !== undefined ? combinedMeta.preMarketPrice : combinedMeta.derivedPreMarketPrice;
                const effectivePost = combinedMeta.postMarketPrice !== undefined ? combinedMeta.postMarketPrice : combinedMeta.derivedPostMarketPrice;

                // Değişim hesapla (MANUEL) -> her zaman previousClose'a göre hesapla; API change alanlarını kullanma
                let change = 0; let changePercent = 0;
                const base = previousPrice && previousPrice !== 0 ? previousPrice : null;
                if (base) {
                    if (marketStatus === 'premarket' && effectivePre !== undefined) {
                        // Premarket değişimi = premarket fiyatı - önceki kapanış
                        change = effectivePre - base;
                        changePercent = (change / base) * 100;
                        console.log(`${symbol} premarket change: ${effectivePre.toFixed(2)} - ${base.toFixed(2)} = ${change.toFixed(2)} (${changePercent.toFixed(2)}%)`);
                    } else if (marketStatus === 'postmarket' && effectivePost !== undefined) {
                        // Postmarket değişimi = postmarket fiyatı - önceki kapanış
                        change = effectivePost - base;
                        changePercent = (change / base) * 100;
                        console.log(`${symbol} postmarket change: ${effectivePost.toFixed(2)} - ${base.toFixed(2)} = ${change.toFixed(2)} (${changePercent.toFixed(2)}%)`);
                    } else if (combinedMeta.regularMarketPrice !== undefined) {
                        // Regular market değişimi = regular fiyatı - önceki kapanış
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
                    technicalAnalysis: combinedMeta.technicalAnalysis || null, // Teknik analiz ekle
                    _lastUpdate: Date.now()
                };

                if (!stocks.some(s => s.symbol === symbol)) {
                    stocks.push(stock);
                    appendStockCard(stock);
                    initializeSortable(); // Yeni hisse eklendiğinde sortable'ı yeniden başlat
                }
                stockData[symbol] = stock; // debug panel için sakla
            } else {
                console.warn(`'${symbol}' için veri alınamadı.`, data);
                if (!initialStocks.includes(symbol)) {
                    alert(`'${symbol}' hissesi bulunamadı.`);
                }
            }
        } catch (error) {
            console.error(`'${symbol}' için veri alınırken hata oluştu:`, error.message);
            // Sadece ilk hissede hata mesajı göster, diğerleri için konsola yaz.
            if (stocks.length === 0) {
                alert(`Veri alınırken bir hata oluştu: ${error.message}. Lütfen internet bağlantınızı ve terminaldeki sunucu loglarını kontrol edin.`);
            }
        }
    }

    function appendStockCard(stock) {
        const changeClass = stock.change >= 0 ? 'positive' : 'negative';
        const sign = stock.change >= 0 ? '+' : '';
        const isFavorite = favorites.includes(stock.symbol);
        const currency = stock.symbol.endsWith('.IS') ? '₺' : '$';
        // Kaynak rozet mapping: Y (yahoo direct), ~ (derived), F (Finnhub)
        function sourceBadgeFor(stock){
            if (stock.marketStatus === 'premarket') {
                if (stock.preMarketDerived) return '<span class="src-badge" title="Kaynak: Yahoo (türetilmiş bar)" data-src="yahoo-derived">~</span>';
                if (stock.preMarketPrice !== undefined && stock.dataSourcePre === 'finnhub') return '<span class="src-badge" title="Kaynak: Finnhub fallback" data-src="finnhub">F</span>';
                if (stock.preMarketPrice !== undefined) return '<span class="src-badge" title="Kaynak: Yahoo" data-src="yahoo">Y</span>';
            } else if (stock.marketStatus === 'postmarket') {
                if (stock.postMarketDerived) return '<span class="src-badge" title="Kaynak: Yahoo (türetilmiş bar)" data-src="yahoo-derived">~</span>';
                if (stock.postMarketPrice !== undefined && stock.dataSourcePost === 'finnhub') return '<span class="src-badge" title="Kaynak: Finnhub fallback" data-src="finnhub">F</span>';
                if (stock.postMarketPrice !== undefined) return '<span class="src-badge" title="Kaynak: Yahoo" data-src="yahoo">Y</span>';
            }
            return '';
        }
        // Yeni tek fiyat gösterimi: pre veya post varsa ana fiyatta gösterilecek.
        let marketStatusLabel = '';
        if (stock.marketStatus === 'premarket') {
            marketStatusLabel = '<div class="market-status inline-badge premarket">PRE</div>';
        } else if (stock.marketStatus === 'postmarket') {
            marketStatusLabel = '<div class="market-status inline-badge postmarket">POST</div>';
        }

        const stockCard = document.createElement('div');
        stockCard.classList.add('stock-card');
        stockCard.dataset.symbol = stock.symbol;
        
        // Gösterilecek ana fiyat: preMarket varsa (badge PRE), yoksa postMarket varsa (badge POST), yoksa regular
        let displayPriceValue = stock.price;
        if (stock.marketStatus === 'premarket' && stock.preMarketPrice !== undefined) {
            displayPriceValue = stock.preMarketPrice;
        } else if (stock.marketStatus === 'postmarket' && stock.postMarketPrice !== undefined) {
            displayPriceValue = stock.postMarketPrice;
        }
        const sourceBadge = sourceBadgeFor(stock);
        
        // Teknik analiz özet bilgisi (UZUN VADELİ)
        let taHtml = '';
        if (stock.technicalAnalysis) {
            const ta = stock.technicalAnalysis;
            let trendEmoji, trendColor, trendShort;
            
            if (ta.signals.overall === 'STRONG_BULLISH') {
                trendEmoji = '�'; trendColor = '#00ff00'; trendShort = 'Güçlü Yükseliş';
            } else if (ta.signals.overall === 'BULLISH') {
                trendEmoji = '📈'; trendColor = '#51cf66'; trendShort = 'Yükseliş';
            } else if (ta.signals.overall === 'STRONG_BEARISH') {
                trendEmoji = '💥'; trendColor = '#ff4444'; trendShort = 'Güçlü Düşüş';
            } else if (ta.signals.overall === 'BEARISH') {
                trendEmoji = '📉'; trendColor = '#ff6b6b'; trendShort = 'Düşüş';
            } else {
                trendEmoji = '➡️'; trendColor = '#ffaa00'; trendShort = 'Yatay';
            }
            
            // Fiyat pozisyonu hesapla (destek/direnç aralığında nerede)
            let positionText = '';
            let positionBadge = '';
            let positionTooltip = '';
            if (ta.indicators.pricePosition !== undefined) {
                const pos = ta.indicators.pricePosition;
                if (pos < 20) {
                    positionText = 'Dip Fiyat';
                    positionBadge = '🟢';
                    positionTooltip = 'Fiyat destek seviyelerine çok yakın. Ekleme yapmak için çok iyi bir seviye.';
                } else if (pos < 40) {
                    positionText = 'İyi Fiyat';
                    positionBadge = '💚';
                    positionTooltip = 'Fiyat destek seviyelerine yakın. Ekleme yapmak için iyi bir seviye.';
                } else if (pos < 60) {
                    positionText = 'Orta Fiyat';
                    positionBadge = '🟡';
                    positionTooltip = 'Fiyat orta seviyelerde. Ne çok ucuz ne çok pahalı.';
                } else if (pos < 80) {
                    positionText = 'Yüksek Fiyat';
                    positionBadge = '🟠';
                    positionTooltip = 'Fiyat direnç seviyelerine yakın. Kısmi satış düşünülebilir.';
                } else {
                    positionText = 'Tepe Fiyat';
                    positionBadge = '🔴';
                    positionTooltip = 'Fiyat direnç seviyelerine çok yakın. Kısmi kar realizasyonu yapılabilir.';
                }
            }
            
            taHtml = `
                <div class="ta-summary" style="margin-top: 16px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.1);">
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
                                <div style="color: #51cf66; font-weight: 600; font-size: 0.9em;">${currency}${ta.recommendations.buyPrice.toFixed(2)}</div>
                            </div>
                            <div style="flex: 1; text-align: right;">
                                <div style="color: #888; font-size: 0.75em; margin-bottom: 4px;">Kısmi Satış</div>
                                <div style="color: #ff6b6b; font-weight: 600; font-size: 0.9em;">${currency}${ta.recommendations.sellPrice.toFixed(2)}</div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }
        
        stockCard.innerHTML = `
            <div class="favorite-star ${isFavorite ? 'active' : 'inactive'}" data-symbol="${stock.symbol}">★</div>
            ${marketStatusLabel}
            
            <div style="display: flex; flex-direction: column; gap: 12px;">
                <div>
                    <h2 style="margin: 0;">${stock.symbol}</h2>
                </div>
                
                <div>
                    <div class="stock-price">${currency}${Number(displayPriceValue).toFixed(2)} ${sourceBadge}</div>
                </div>
                
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <div class="stock-change ${changeClass}">
                        ${sign}${Number(stock.change).toFixed(2)} ${currency}
                    </div>
                    <div class="stock-change-percent ${changeClass}">
                        ${sign}${Number(stock.changePercent).toFixed(2)}%
                    </div>
                </div>
                
                ${taHtml}
            </div>
        `;
        
        // Favori yıldızına tıklama olayı
        const starElement = stockCard.querySelector('.favorite-star');
        starElement.addEventListener('click', (e) => {
            e.stopPropagation(); // Kart tıklamasını engelle
            toggleFavorite(stock.symbol);
        });
        
        // Kart tıklaması (grafik açma)
        stockCard.addEventListener('click', () => openChartModal(stock.symbol));
        stockContainer.appendChild(stockCard);
    }

    function openChartModal(symbol) {
        const stock = stocks.find(s => s.symbol === symbol);
        if (!stock) return;

        currentStock = stock;
        modalStockSymbol.textContent = stock.symbol;
        modal.style.display = 'flex';
        
        // Varsayılan olarak Grafik sekmesini göster
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        document.querySelector('[data-tab="chart"]').classList.add('active');
        document.getElementById('chart-tab').classList.add('active');
        
        // Teknik Analiz Panelini Doldur
        renderTechnicalAnalysisPanel(stock);
        
        // Varsayılan zaman dilimini ayarla
        currentTimeframe = '1d';
        document.querySelectorAll('.timeframe-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('[data-period="1d"]').classList.add('active');
        
        // Zaman dilimi butonlarını initialize et
        initializeTimeframeButtons();
        
        // Sekme butonları event listener
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                const tabName = this.getAttribute('data-tab');
                switchTab(tabName);
            });
        });
        
        // TradingView widget'ını yükle
        loadTradingViewChart(symbol, currentTimeframe);
    }
    
    function switchTab(tabName) {
        // Tüm sekmeleri gizle
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });
        
        // Tüm butonları pasif yap
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        
        // Seçili sekmeyi göster
        document.getElementById(tabName + '-tab').classList.add('active');
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    }
    
    function renderTechnicalAnalysisPanel(stock) {
        const taPanel = document.getElementById('technical-analysis-panel');
        const currency = stock.symbol.endsWith('.IS') ? '₺' : '$';
        
        if (!stock.technicalAnalysis) {
            taPanel.innerHTML = '<div style="padding: 20px; text-align: center; color: #888;">Teknik analiz verileri yükleniyor...</div>';
            return;
        }
        
        const ta = stock.technicalAnalysis;
        const ind = ta.indicators;
        const sig = ta.signals;
        const rec = ta.recommendations;
        
        // Trend rengi ve emoji (UZUN VADELİ)
        let trendClass, trendEmoji, trendText;
        if (sig.overall === 'STRONG_BULLISH') {
            trendClass = 'trend-bullish';
            trendEmoji = '🚀';
            trendText = 'Güçlü Yükseliş';
        } else if (sig.overall === 'BULLISH') {
            trendClass = 'trend-bullish';
            trendEmoji = '📈';
            trendText = 'Yükseliş';
        } else if (sig.overall === 'STRONG_BEARISH') {
            trendClass = 'trend-bearish';
            trendEmoji = '�';
            trendText = 'Güçlü Düşüş';
        } else if (sig.overall === 'BEARISH') {
            trendClass = 'trend-bearish';
            trendEmoji = '📉';
            trendText = 'Düşüş';
        } else {
            trendClass = 'trend-neutral';
            trendEmoji = '➡️';
            trendText = 'Yatay';
        }
        
        // RSI rengi
        let rsiClass = 'rsi-neutral';
        if (ind.rsi < 30) rsiClass = 'rsi-oversold';
        else if (ind.rsi > 70) rsiClass = 'rsi-overbought';
        
        taPanel.innerHTML = `
            <div class="ta-header">
                <div class="ta-trend ${trendClass}">
                    <span>${trendEmoji}</span>
                    <span>Uzun Vade Trend: ${trendText}</span>
                </div>
                <div style="font-size: 0.9em; color: #888;">
                    Güncel: ${currency}${ta.currentPrice.toFixed(2)}
                </div>
            </div>
            
            <div class="ta-recommendations">
                <div class="ta-rec-box buy">
                    <div class="ta-rec-label">🎯 Ekleme Yapılabilecek Seviye</div>
                    <div class="ta-rec-value">${currency}${rec.buyPrice.toFixed(2)}</div>
                    <div style="font-size: 0.75em; color: #aaa; margin-top: 5px; line-height: 1.4; font-weight: 500;">
                        ${rec.buyReason ? rec.buyReason.replace(/,/g, '<br>• ') : 'Teknik destek seviyesi'}
                    </div>
                    <div style="font-size: 0.8em; color: #ff6b6b; margin-top: 8px; font-weight: bold;">⚠️ Felaket Stop: ${currency}${rec.stopLoss.toFixed(2)}</div>
                    <div style="font-size: 0.7em; color: #666; margin-top: 2px;">(Sadece büyük kriz senaryosu için - Normalde stop kullanma)</div>
                </div>
                <div class="ta-rec-box sell">
                    <div class="ta-rec-label">💰 Kısmi Satış (1. Hedef)</div>
                    <div class="ta-rec-value">${currency}${rec.sellPrice.toFixed(2)}</div>
                    <div style="font-size: 0.75em; color: #aaa; margin-top: 5px; line-height: 1.4; font-weight: 500;">
                        ${rec.sellReason ? rec.sellReason.replace(/,/g, '<br>• ') : 'Direnç seviyesi'}
                    </div>
                    <div style="font-size: 0.8em; color: #51cf66; margin-top: 8px; font-weight: bold;">✨ 2. Hedef (Daha Fazla Yükselirse): ${currency}${rec.takeProfit.toFixed(2)}</div>
                    <div style="font-size: 0.7em; color: #666; margin-top: 2px;">(Kalan pozisyonun bir kısmını daha sat)</div>
                </div>
            </div>
            
            <div class="tooltip-container" style="background: #2a2d35; padding: 12px; border-radius: 8px; margin-bottom: 15px; text-align: center; position: relative;">
                <div style="color: #888; font-size: 0.85em; margin-bottom: 5px;">
                    Risk/Ödül Oranı <span class="info-icon">ℹ️</span>
                </div>
                <div class="tooltip">Potansiyel kazancın potansiyel kayba oranı. 2'nin üstü mükemmel, 1.5'in üstü iyi kabul edilir. Bu oran ne kadar yüksekse işlem o kadar karlı olabilir.</div>
                <div style="color: #fff; font-size: 1.3em; font-weight: bold;">${rec.riskRewardRatio}</div>
                <div style="color: #666; font-size: 0.75em; margin-top: 3px;">
                    (${rec.riskRewardRatio > 2 ? 'Mükemmel' : rec.riskRewardRatio > 1.5 ? 'İyi' : 'Orta'} fırsat)
                </div>
            </div>
            
            <div class="ta-indicators">
                ${ind.ema50 ? `
                <div class="ta-indicator tooltip-container">
                    <div class="ta-ind-name">EMA 50 <span class="info-icon">ℹ️</span></div>
                    <div class="tooltip">50 günlük üstel hareketli ortalama. Kısa-orta vade trendini gösterir. Fiyatın bu seviyenin üstünde olması kısa vadede güçlü olduğunu gösterir.</div>
                    <div class="ta-ind-value">${currency}${ind.ema50.toFixed(2)}</div>
                    <div style="font-size: 0.7em; color: ${ta.currentPrice > ind.ema50 ? '#51cf66' : '#ff6b6b'};">
                        ${ta.currentPrice > ind.ema50 ? '▲ Üzerinde' : '▼ Altında'}
                    </div>
                </div>` : ''}
                
                ${ind.ema100 ? `
                <div class="ta-indicator tooltip-container">
                    <div class="ta-ind-name">EMA 100 <span class="info-icon">ℹ️</span></div>
                    <div class="tooltip">100 günlük üstel hareketli ortalama. Orta vade trendini gösterir. Bu seviye genellikle önemli bir destek/direnç oluşturur.</div>
                    <div class="ta-ind-value">${currency}${ind.ema100.toFixed(2)}</div>
                    <div style="font-size: 0.7em; color: ${ta.currentPrice > ind.ema100 ? '#51cf66' : '#ff6b6b'};">
                        ${ta.currentPrice > ind.ema100 ? '▲ Üzerinde' : '▼ Altında'}
                    </div>
                </div>` : ''}
                
                ${ind.ema200 ? `
                <div class="ta-indicator tooltip-container">
                    <div class="ta-ind-name">EMA 200 <span class="info-icon">ℹ️</span></div>
                    <div class="tooltip">200 günlük üstel hareketli ortalama. Uzun vade trendini gösterir. En güçlü destek/direnç seviyesidir. Bu seviyenin altına düşmek trend değişimi işareti olabilir.</div>
                    <div class="ta-ind-value">${currency}${ind.ema200.toFixed(2)}</div>
                    <div style="font-size: 0.7em; color: ${ta.currentPrice > ind.ema200 ? '#51cf66' : '#ff6b6b'};">
                        ${ta.currentPrice > ind.ema200 ? '▲ Üzerinde' : '▼ Altında'}
                    </div>
                </div>` : ''}
                
                ${ind.rsi ? `
                <div class="ta-indicator tooltip-container">
                    <div class="ta-ind-name">RSI (14) <span class="info-icon">ℹ️</span></div>
                    <div class="tooltip">Göreceli Güç Endeksi. 30'un altı: Aşırı satım (ucuz olabilir), 70'in üstü: Aşırı alım (pahalı olabilir), 30-70 arası: Normal seviye.</div>
                    <div class="ta-ind-value ${rsiClass}">${ind.rsi.toFixed(1)}</div>
                </div>` : ''}
                
                ${ind.macd ? `
                <div class="ta-indicator tooltip-container">
                    <div class="ta-ind-name">MACD <span class="info-icon">ℹ️</span></div>
                    <div class="tooltip">Momentum göstergesi. MACD çizgisi Signal çizgisinin üstüne çıkarsa yükseliş, altına inerse düşüş momentumu başlayabilir.</div>
                    <div class="ta-ind-value">${ind.macd.macd.toFixed(2)}</div>
                    <div style="font-size: 0.7em; color: #888; margin-top: 3px;">Signal: ${ind.macd.signal.toFixed(2)}</div>
                </div>` : ''}
                
                ${ind.bollingerBands ? `
                <div class="ta-indicator tooltip-container">
                    <div class="ta-ind-name">Bollinger Bands <span class="info-icon">ℹ️</span></div>
                    <div class="tooltip">Volatilite bandı. Fiyat üst banda yaklaşırsa pahalı, alt banda yaklaşırsa ucuz olabilir. Bantların genişlemesi volatilitenin arttığını gösterir.</div>
                    <div class="ta-ind-value" style="font-size: 0.9em;">
                        <div>Üst: ${currency}${ind.bollingerBands.upper.toFixed(2)}</div>
                        <div style="color: #888;">Orta: ${currency}${ind.bollingerBands.middle.toFixed(2)}</div>
                        <div>Alt: ${currency}${ind.bollingerBands.lower.toFixed(2)}</div>
                    </div>
                </div>` : ''}
            </div>
            
            ${ind.supportResistance ? `
            <div class="support-resistance">
                <div class="sr-box tooltip-container">
                    <div class="sr-label">📊 Teknik Destek <span class="info-icon">ℹ️</span></div>
                    <div class="tooltip">Geçmiş fiyat hareketlerine göre hesaplanan destek seviyesi. Fiyat bu seviyeye yaklaşırsa alım yapmak için iyi bir fırsat olabilir.</div>
                    <div class="sr-value support">${currency}${ind.supportResistance.support ? ind.supportResistance.support.toFixed(2) : 'N/A'}</div>
                </div>
                <div class="sr-box tooltip-container">
                    <div class="sr-label">📊 Teknik Direnç <span class="info-icon">ℹ️</span></div>
                    <div class="tooltip">Geçmiş fiyat hareketlerine göre hesaplanan direnç seviyesi. Fiyat bu seviyeye yaklaşırsa kısmi kar realizasyonu düşünülebilir.</div>
                    <div class="sr-value resistance">${currency}${ind.supportResistance.resistance ? ind.supportResistance.resistance.toFixed(2) : 'N/A'}</div>
                </div>
            </div>` : ''}
            
            ${sig.messages && sig.messages.length > 0 ? `
            <div class="ta-signals">
                <div class="ta-signals-title">📢 Aktif Sinyaller</div>
                ${sig.messages.map(msg => `<div class="ta-signal-item">${msg}</div>`).join('')}
            </div>` : ''}
        `;
    }

    function loadTradingViewChart(symbol, timeframe) {
        // Önceki widget'ı temizle
        if (tradingViewChart) {
            tradingViewChart.remove();
        }
        
        // Widget container'ını temizle
        tradingViewWidget.innerHTML = '';
        
        // Zaman dilimini TradingView formatına çevir
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
        
        // Sembol formatını belirle
        let symbolFormat = `NASDAQ:${symbol}`;
        
        // Bazı hisseler farklı borsalarda
        const nyseStocks = ['UNH', 'CRM', 'TEAM', 'DKNG', 'HUBS', 'MRVL', 'SMCI', 'HIMS', 'CYBR', 'UBER', 'COIN', 'SPOT'];
        const nasdaqStocks = ['AMD', 'NVDA', 'HOOD', 'RKLB', 'META', 'SOFI', 'PLTR', 'TSLA', 'AVGO', 'GOOGL', 'AAPL', 'MSFT', 'AMZN', 'INTC', 'CRWD'];
        
        if (nyseStocks.includes(symbol)) {
            symbolFormat = `NYSE:${symbol}`;
        } else if (nasdaqStocks.includes(symbol)) {
            symbolFormat = `NASDAQ:${symbol}`;
        } else {
            // Varsayılan olarak NASDAQ dene
            symbolFormat = `NASDAQ:${symbol}`;
        }
        
        console.log(`Grafik yükleniyor: ${symbolFormat}`);
        
        // TradingView widget'ını oluştur
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
                    // Volume (Hacim)
                    "Volume@tv-basicstudies",
                    
                    // EMA 50, 100, 200 (Uzun Vadeli Trendler)
                    {
                        "id": "MAExp@tv-basicstudies",
                        "inputs": {
                            "length": 50,
                            "source": "close"
                        }
                    },
                    {
                        "id": "MAExp@tv-basicstudies",
                        "inputs": {
                            "length": 100,
                            "source": "close"
                        }
                    },
                    {
                        "id": "MAExp@tv-basicstudies",
                        "inputs": {
                            "length": 200,
                            "source": "close"
                        }
                    },
                    
                    // RSI (Relative Strength Index)
                    {
                        "id": "RSI@tv-basicstudies",
                        "inputs": {
                            "length": 14
                        }
                    },
                    
                    // MACD (Moving Average Convergence Divergence)
                    {
                        "id": "MACD@tv-basicstudies",
                        "inputs": {
                            "fast_length": 12,
                            "slow_length": 26,
                            "signal_length": 9
                        }
                    },
                    
                    // Bollinger Bands
                    {
                        "id": "BB@tv-basicstudies",
                        "inputs": {
                            "length": 20,
                            "mult": 2
                        }
                    }
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

    // ESC tuşu ile modal'ı kapat
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && modal.style.display === 'flex') {
            modal.style.display = 'none';
        }
    });

    // Zaman dilimi butonları - DOM yüklendikten sonra
    function initializeTimeframeButtons() {
        document.querySelectorAll('.timeframe-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('Zaman dilimi değiştiriliyor:', btn.dataset.period);
                
                // Aktif butonu güncelle
                document.querySelectorAll('.timeframe-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                // Yeni zaman dilimini ayarla
                currentTimeframe = btn.dataset.period;
                
                // Grafiği yeniden yükle
                if (currentStock) {
                    console.log(`${currentStock.symbol} için ${currentTimeframe} verisi yükleniyor...`);
                    loadTradingViewChart(currentStock.symbol, currentTimeframe);
                }
            });
        });
    }
    // Tüm hisse fiyatlarını güncelle (tekleştirilmiş mantık)
    async function updateAllStockPrices() {
        if (isUpdating) return;
        isUpdating = true;
        const refreshBtn = document.getElementById('refresh-btn');
        refreshBtn.classList.add('updating');
        refreshBtn.disabled = true;
        console.log('Fiyatlar güncelleniyor...');
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
                        marketState: meta.marketState
                    });
                    // previousClose belirleme: piyasa durumuna göre
                    let previousClose;
                    if (meta.marketState === 'PRE' || meta.marketState === 'POST') {
                        previousClose = meta.regularMarketPrice || meta.chartPreviousClose || meta.previousClose;
                    } else {
                        previousClose = meta.previousClose || meta.chartPreviousClose || meta.regularMarketPrice;
                    }
                    
                    // Market status - SADECE marketState'e göre belirle
                    let marketStatus = 'normal';
                    if (meta.marketState === 'PRE') {
                        marketStatus = 'premarket';
                    } else if (meta.marketState === 'POST') {
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
                    // Eski değerleri kaydet
                    const oldPrice = stock.price; const oldChange = stock.change; const oldChangePercent = stock.changePercent;
                    // Güncelle
                    stock.price = displayPrice; // artı: card logic tekrar hesaplamasın
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
                    stock.technicalAnalysis = meta.technicalAnalysis || stock.technicalAnalysis; // Teknik analizi güncelle
                    stock._lastUpdate = Date.now();
                    stockData[stock.symbol] = stock;
                    updateStockCard(stock, oldPrice, oldChange, oldChangePercent);
                } catch(e){ console.error('Update fail', stock.symbol, e.message); }
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

    // Hisse kartını güncelle
    function updateStockCard(stock, oldPrice, oldChange, oldChangePercent) {
        const stockCard = document.querySelector(`[data-symbol="${stock.symbol}"]`);
        if (!stockCard) return;
        
        const priceElement = stockCard.querySelector('.stock-price');
        const changeElement = stockCard.querySelector('.stock-change');
        const changePercentElement = stockCard.querySelector('.stock-change-percent');
        const marketStatusElement = stockCard.querySelector('.market-status');
        
        // Piyasa durumu etiketini güncelle
        if (marketStatusElement) {
            marketStatusElement.remove(); // Eski etiketi kaldır
        }
        
        // Önce eski market-status badge'lerini temizle
        const oldStatusLabel = stockCard.querySelector('.market-status');
        if (oldStatusLabel) {
            oldStatusLabel.remove();
        }
        
        // Yeni piyasa durumu etiketini ekle (sadece PRE veya POST için)
        if (stock.marketStatus === 'premarket') {
            const statusLabel = document.createElement('div');
            statusLabel.className = 'market-status inline-badge premarket';
            statusLabel.textContent = 'PRE';
            stockCard.insertBefore(statusLabel, stockCard.querySelector('h2'));
        } else if (stock.marketStatus === 'postmarket') {
            const statusLabel = document.createElement('div');
            statusLabel.className = 'market-status inline-badge postmarket';
            statusLabel.textContent = 'POST';
            stockCard.insertBefore(statusLabel, stockCard.querySelector('h2'));
        }
        // Normal market (REGULAR) durumunda hiçbir badge eklenmez
        
        if (priceElement) {
            // Fiyat değişimini vurgula
            if (stock.price > oldPrice) {
                priceElement.style.color = '#2ecc71';
                priceElement.style.animation = 'priceUp 0.5s ease-in-out';
            } else if (stock.price < oldPrice) {
                priceElement.style.color = '#e74c3c';
                priceElement.style.animation = 'priceDown 0.5s ease-in-out';
            }
            
            setTimeout(() => {
                priceElement.style.color = '';
                priceElement.style.animation = '';
            }, 500);
            
            const currency = stock.symbol.endsWith('.IS') ? '₺' : '$';
            // MANUEL PREMARKET FİYATLARI KULLAN (API'ler yanlış veri veriyor)
            let displayPriceValue = stock.price;
            if (stock.marketStatus === 'premarket' && stock.preMarketPrice !== undefined) {
                displayPriceValue = stock.preMarketPrice;
            } else if (stock.marketStatus === 'postmarket' && stock.postMarketPrice !== undefined) {
                displayPriceValue = stock.postMarketPrice;
            }
            const sourceBadge = sourceBadgeFor(stock);
            priceElement.innerHTML = `${currency}${Number(displayPriceValue).toFixed(2)} ${sourceBadge}`;
            console.log(`[CARD UPDATE] ${stock.symbol} price: ${displayPriceValue}, change: ${stock.change}, changePercent: ${stock.changePercent}`);
        }
        
        if (changeElement) {
            const sign = Number(stock.change) >= 0 ? '+' : '';
            changeElement.textContent = `${sign}${Number(stock.change).toFixed(2)}`;
            changeElement.style.color = Number(stock.change) >= 0 ? '#2ecc71' : '#e74c3c';
            changeElement.className = `stock-change ${Number(stock.change) >= 0 ? 'positive' : 'negative'}`;
        }
        
        if (changePercentElement) {
            const sign = Number(stock.changePercent) >= 0 ? '+' : '';
            changePercentElement.textContent = `(${sign}${Number(stock.changePercent).toFixed(2)}%)`;
            changePercentElement.style.color = Number(stock.changePercent) >= 0 ? '#2ecc71' : '#e74c3c';
            changePercentElement.className = `stock-change-percent ${Number(stock.changePercent) >= 0 ? 'positive' : 'negative'}`;
        }
        
        // Teknik Analiz özetini güncelle (UZUN VADELİ)
        let taElement = stockCard.querySelector('.ta-summary');
        if (stock.technicalAnalysis) {
            const ta = stock.technicalAnalysis;
            let trendEmoji, trendColor, trendShort;
            
            if (ta.signals.overall === 'STRONG_BULLISH') {
                trendEmoji = '�'; trendColor = '#00ff00'; trendShort = 'Güçlü Yükseliş';
            } else if (ta.signals.overall === 'BULLISH') {
                trendEmoji = '📈'; trendColor = '#51cf66'; trendShort = 'Yükseliş';
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
                    positionTooltip = 'Fiyat destek seviyelerine çok yakın. Ekleme yapmak için çok iyi bir seviye.';
                } else if (pos < 40) {
                    positionText = 'İyi Fiyat';
                    positionBadge = '💚';
                    positionTooltip = 'Fiyat destek seviyelerine yakın. Ekleme yapmak için iyi bir seviye.';
                } else if (pos < 60) {
                    positionText = 'Orta Fiyat';
                    positionBadge = '🟡';
                    positionTooltip = 'Fiyat orta seviyelerde. Ne çok ucuz ne çok pahalı.';
                } else if (pos < 80) {
                    positionText = 'Yüksek Fiyat';
                    positionBadge = '🟠';
                    positionTooltip = 'Fiyat direnç seviyelerine yakın. Kısmi satış düşünülebilir.';
                } else {
                    positionText = 'Tepe Fiyat';
                    positionBadge = '🔴';
                    positionTooltip = 'Fiyat direnç seviyelerine çok yakın. Kısmi kar realizasyonu yapılabilir.';
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
                            <div style="color: #51cf66; font-weight: 600; font-size: 0.9em;">${currency}${ta.recommendations.buyPrice.toFixed(2)}</div>
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

    // Otomatik güncelleme durdur
    function stopAutoUpdate() {
        if (updateInterval) {
            clearInterval(updateInterval);
            updateInterval = null;
            console.log('Otomatik güncelleme durduruldu');
        }
    }



    // Hisse kartını güncelle
    function updateStockCard(stock, oldPrice, oldChange, oldChangePercent) {
        const stockCard = document.querySelector(`[data-symbol="${stock.symbol}"]`);
        if (!stockCard) return;
        
        const priceElement = stockCard.querySelector('.stock-price');
        const changeElement = stockCard.querySelector('.stock-change');
        const changePercentElement = stockCard.querySelector('.stock-change-percent');
        const marketStatusElement = stockCard.querySelector('.market-status');
        
        // Piyasa durumu etiketini güncelle
        if (marketStatusElement) {
            marketStatusElement.remove();
        }
        
        // Yeni piyasa durumu etiketini ekle
        if (stock.marketStatus === 'premarket') {
            const statusLabel = document.createElement('div');
            statusLabel.className = 'market-status premarket';
            statusLabel.textContent = 'Öncesi';
            stockCard.insertBefore(statusLabel, stockCard.querySelector('h2'));
        } else if (stock.marketStatus === 'postmarket') {
            const statusLabel = document.createElement('div');
            statusLabel.className = 'market-status postmarket';
            statusLabel.textContent = 'Sonrası';
            stockCard.insertBefore(statusLabel, stockCard.querySelector('h2'));
        }
        
        if (priceElement) {
            // Fiyat değişimini vurgula
            if (stock.price > oldPrice) {
                priceElement.style.color = '#2ecc71';
                priceElement.style.animation = 'priceUp 0.5s ease-in-out';
            } else if (stock.price < oldPrice) {
                priceElement.style.color = '#e74c3c';
                priceElement.style.animation = 'priceDown 0.5s ease-in-out';
            }
            
            setTimeout(() => {
                priceElement.style.color = '';
                priceElement.style.animation = '';
            }, 500);
            
            const currency = stock.symbol.endsWith('.IS') ? '₺' : '$';
            priceElement.textContent = `${currency}${Number(stock.price).toFixed(2)}`;
        }
        
        if (changeElement) {
            const sign = Number(stock.change) >= 0 ? '+' : '';
            changeElement.textContent = `${sign}${Number(stock.change).toFixed(2)}`;
            changeElement.style.color = Number(stock.change) >= 0 ? '#2ecc71' : '#e74c3c';
            changeElement.className = `stock-change ${Number(stock.change) >= 0 ? 'positive' : 'negative'}`;
        }
        
        if (changePercentElement) {
            const sign = Number(stock.changePercent) >= 0 ? '+' : '';
            changePercentElement.textContent = `(${sign}${Number(stock.changePercent).toFixed(2)}%)`;
            changePercentElement.style.color = Number(stock.changePercent) >= 0 ? '#2ecc71' : '#e74c3c';
            changePercentElement.className = `stock-change-percent ${Number(stock.changePercent) >= 0 ? 'positive' : 'negative'}`;
        }
    }

    loadInitialStocks();
    startAutoUpdate();
    
    // Manuel yenile butonu
    const refreshBtn = document.getElementById('refresh-btn');
    refreshBtn.addEventListener('click', () => {
        updateAllStockPrices();
    });

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

    // Periyodik olarak debug tablosunu güncelle (aktifse)
    setInterval(() => { if(debugPanelEnabled) renderDebugTable(); }, 5000);
});