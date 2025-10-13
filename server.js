const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 8084;
const CACHE_TTL_MS = 5 * 1000; // 5 saniye
const cache = new Map();

// ============================================
// TEKNİK ANALİZ FONKSİYONLARI
// ============================================

// EMA (Exponential Moving Average) hesapla
function calculateEMA(prices, period) {
    if (!prices || prices.length < period) return null;
    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    
    for (let i = period; i < prices.length; i++) {
        ema = (prices[i] - ema) * multiplier + ema;
    }
    return ema;
}

// RSI (Relative Strength Index) hesapla
function calculateRSI(prices, period = 14) {
    if (!prices || prices.length < period + 1) return null;
    
    let gains = 0, losses = 0;
    
    // İlk period için ortalama kazanç/kayıp
    for (let i = 1; i <= period; i++) {
        const change = prices[i] - prices[i - 1];
        if (change > 0) gains += change;
        else losses -= change;
    }
    
    let avgGain = gains / period;
    let avgLoss = losses / period;
    
    // Kalan veriler için smoothed average
    for (let i = period + 1; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        if (change > 0) {
            avgGain = (avgGain * (period - 1) + change) / period;
            avgLoss = (avgLoss * (period - 1)) / period;
        } else {
            avgGain = (avgGain * (period - 1)) / period;
            avgLoss = (avgLoss * (period - 1) - change) / period;
        }
    }
    
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

// ATR (Average True Range) hesapla
function calculateATR(highs, lows, closes, period = 14) {
    if (!highs || highs.length < period + 1) return null;
    
    const trueRanges = [];
    for (let i = 1; i < highs.length; i++) {
        const tr = Math.max(
            highs[i] - lows[i],
            Math.abs(highs[i] - closes[i - 1]),
            Math.abs(lows[i] - closes[i - 1])
        );
        trueRanges.push(tr);
    }
    
    // İlk ATR - basit ortalama
    let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
    
    // Smoothed ATR
    for (let i = period; i < trueRanges.length; i++) {
        atr = (atr * (period - 1) + trueRanges[i]) / period;
    }
    
    return atr;
}

// UT Bot Alerts hesapla (ATR bazlı trailing stop)
function calculateUTBot(highs, lows, closes, atrPeriod = 10, atrMultiplier = 3.0) {
    if (!closes || closes.length < atrPeriod + 1) return null;
    
    const atr = calculateATR(highs, lows, closes, atrPeriod);
    if (!atr) return null;
    
    const currentPrice = closes[closes.length - 1];
    const src = closes[closes.length - 1]; // HL2 yerine close kullan
    
    // Trailing stop seviyeleri
    const trailingStop = atr * atrMultiplier;
    
    // Basit trend belirleme
    const ema21 = calculateEMA(closes, 21);
    const trend = currentPrice > ema21 ? 'LONG' : 'SHORT';
    
    return {
        buyLevel: currentPrice - trailingStop,
        sellLevel: currentPrice + trailingStop,
        atr: atr,
        trend: trend
    };
}

// MACD hesapla
function calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    if (!prices || prices.length < slowPeriod + signalPeriod) return null;
    
    const emaFast = calculateEMA(prices, fastPeriod);
    const emaSlow = calculateEMA(prices, slowPeriod);
    
    if (!emaFast || !emaSlow) return null;
    
    const macdLine = emaFast - emaSlow;
    
    // Signal line için MACD değerlerinin EMA'sını hesapla (basitleştirilmiş)
    const signal = macdLine * 0.8; // Yaklaşık değer
    const histogram = macdLine - signal;
    
    return {
        macd: macdLine,
        signal: signal,
        histogram: histogram,
        trend: histogram > 0 ? 'BULLISH' : 'BEARISH'
    };
}

// Bollinger Bands hesapla
function calculateBollingerBands(prices, period = 20, stdDev = 2) {
    if (!prices || prices.length < period) return null;
    
    const recentPrices = prices.slice(-period);
    const sma = recentPrices.reduce((a, b) => a + b, 0) / period;
    
    const squaredDiffs = recentPrices.map(price => Math.pow(price - sma, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
    const standardDeviation = Math.sqrt(variance);
    
    return {
        upper: sma + (standardDeviation * stdDev),
        middle: sma,
        lower: sma - (standardDeviation * stdDev),
        bandwidth: ((sma + (standardDeviation * stdDev)) - (sma - (standardDeviation * stdDev))) / sma * 100
    };
}

// Fibonacci Retracement seviyeleri hesapla
function calculateFibonacci(high, low) {
    const diff = high - low;
    return {
        level_0: high,
        level_236: high - (diff * 0.236),
        level_382: high - (diff * 0.382),
        level_500: high - (diff * 0.500),
        level_618: high - (diff * 0.618),
        level_786: high - (diff * 0.786),
        level_100: low
    };
}

// Pivot Points hesapla (günlük destek/direnç)
function calculatePivotPoints(high, low, close) {
    const pivot = (high + low + close) / 3;
    
    return {
        pivot: pivot,
        r1: (2 * pivot) - low,
        r2: pivot + (high - low),
        r3: high + 2 * (pivot - low),
        s1: (2 * pivot) - high,
        s2: pivot - (high - low),
        s3: low - 2 * (high - pivot)
    };
}

// Destek ve Direnç seviyeleri bul
function findSupportResistance(closes, highs, lows) {
    if (!closes || closes.length < 20) return null;
    
    const recent = closes.slice(-20);
    const recentHighs = highs.slice(-20);
    const recentLows = lows.slice(-20);
    
    const high = Math.max(...recentHighs);
    const low = Math.min(...recentLows);
    const current = closes[closes.length - 1];
    
    // Pivot noktaları kullan
    const pivots = calculatePivotPoints(high, low, current);
    
    return {
        resistance: [pivots.r1, pivots.r2, pivots.r3].filter(r => r > current).sort((a, b) => a - b)[0],
        support: [pivots.s1, pivots.s2, pivots.s3].filter(s => s < current).sort((a, b) => b - a)[0],
        allLevels: pivots
    };
}

// Kapsamlı teknik analiz yap (UZUN VADELİ YATIRIM STRATEJİSİ)
function performTechnicalAnalysis(ohlcData) {
    if (!ohlcData || !ohlcData.closes || ohlcData.closes.length < 200) {
        return null;
    }
    
    const { opens, highs, lows, closes, volumes } = ohlcData;
    const currentPrice = closes[closes.length - 1];
    
    // Uzun vadeli EMA'lar
    const ema50 = calculateEMA(closes, 50);
    const ema100 = calculateEMA(closes, 100);
    const ema200 = calculateEMA(closes, 200);
    const rsi = calculateRSI(closes, 14);
    const macd = calculateMACD(closes);
    const bb = calculateBollingerBands(closes, 20, 2);
    const sr = findSupportResistance(closes, highs, lows);
    
    // Son 50 günün en yüksek ve en düşük değerleri
    const recent50Highs = highs.slice(-50);
    const recent50Lows = lows.slice(-50);
    const high50 = Math.max(...recent50Highs);
    const low50 = Math.min(...recent50Lows);
    
    // UZUN VADELİ TREND ANALİZİ (EMA 50-100-200)
    let longTermTrend = 'NEUTRAL';
    let trendStrength = 0;
    
    if (ema50 && ema100 && ema200) {
        // Güçlü yükseliş trendi: Fiyat > EMA50 > EMA100 > EMA200
        if (currentPrice > ema50 && ema50 > ema100 && ema100 > ema200) {
            longTermTrend = 'STRONG_BULLISH';
            trendStrength = 3;
        }
        // Orta yükseliş trendi: Fiyat > EMA50 ve EMA50 > EMA200
        else if (currentPrice > ema50 && ema50 > ema200) {
            longTermTrend = 'BULLISH';
            trendStrength = 2;
        }
        // Güçlü düşüş trendi: Fiyat < EMA50 < EMA100 < EMA200
        else if (currentPrice < ema50 && ema50 < ema100 && ema100 < ema200) {
            longTermTrend = 'STRONG_BEARISH';
            trendStrength = -3;
        }
        // Orta düşüş trendi: Fiyat < EMA50 ve EMA50 < EMA200
        else if (currentPrice < ema50 && ema50 < ema200) {
            longTermTrend = 'BEARISH';
            trendStrength = -2;
        }
    }
    
    // UZUN VADELİ ALIM/SATIM FİYATLARI
    let buyPrice, sellPrice, stopLoss, takeProfit;
    let buyReason = [];
    let sellReason = [];
    let signals = [];
    
    // EKLEME STRATEJİSİ (Buy & Hold + Destek Seviyelerinden Alım)
    // Güçlü destek seviyelerinde ekleme yap
    const supportLevels = [];
    
    if (ema200) {
        supportLevels.push({ price: ema200, reason: 'EMA 200 (Çok güçlü destek)' });
    }
    if (ema100) {
        supportLevels.push({ price: ema100, reason: 'EMA 100 (Güçlü destek)' });
    }
    if (ema50 && currentPrice > ema50) {
        supportLevels.push({ price: ema50, reason: 'EMA 50 (Orta vade destek)' });
    }
    if (sr?.support) {
        supportLevels.push({ price: sr.support, reason: 'Teknik destek seviyesi' });
    }
    if (bb?.lower) {
        supportLevels.push({ price: bb.lower, reason: 'Bollinger alt bandı' });
    }
    
    // En yakın destek seviyesini bul (mevcut fiyatın altında)
    const validSupports = supportLevels.filter(s => s.price < currentPrice).sort((a, b) => b.price - a.price);
    
    if (validSupports.length > 0) {
        buyPrice = validSupports[0].price;
        buyReason.push(validSupports[0].reason);
        
        // İkinci destek seviyesi varsa ekle
        if (validSupports.length > 1) {
            buyReason.push(`2. Destek: ${validSupports[1].reason} (${validSupports[1].price.toFixed(2)})`);
        }
    } else {
        // Hiç destek yoksa son 50 günün dip seviyesi
        buyPrice = low50;
        buyReason.push('50 günlük dip seviyesi');
    }
    
    // KISMİ SATIŞ STRATEJİSİ (Pahalı olduğunda nakit elde et)
    // Direnç seviyelerinde veya aşırı yükseldiğinde kısmi sat
    const resistanceLevels = [];
    
    if (sr?.resistance) {
        resistanceLevels.push({ price: sr.resistance, reason: 'Teknik direnç seviyesi' });
    }
    if (bb?.upper) {
        resistanceLevels.push({ price: bb.upper, reason: 'Bollinger üst bandı' });
    }
    
    // 50 günlük en yüksek + %5 (pahalı bölge)
    resistanceLevels.push({ price: high50 * 1.05, reason: '50 günlük zirve + %5' });
    
    // Fibonacci extension %161.8 (güçlü kar al bölgesi)
    const fibExtension = currentPrice + ((high50 - low50) * 1.618);
    resistanceLevels.push({ price: fibExtension, reason: 'Fibonacci %161.8 Extension' });
    
    // En yakın direnç seviyesini bul (mevcut fiyatın üstünde)
    const validResistances = resistanceLevels.filter(r => r.price > currentPrice).sort((a, b) => a.price - b.price);
    
    if (validResistances.length > 0) {
        sellPrice = validResistances[0].price;
        sellReason.push(`Kısmi satış: ${validResistances[0].reason}`);
        
        // İkinci direnç seviyesi varsa ekle
        if (validResistances.length > 1) {
            sellReason.push(`2. Hedef: ${validResistances[1].reason} (${validResistances[1].price.toFixed(2)})`);
        }
    } else {
        sellPrice = high50 * 1.1;
        sellReason.push('50 günlük zirve + %10');
    }
    
    // STOP LOSS (Uzun vade için çok geniş - sadece felaket senaryosu)
    stopLoss = ema200 ? ema200 * 0.90 : buyPrice * 0.85;  // EMA200'ün %10 altı veya alışın %15 altı
    
    // TAKE PROFIT (Kısmi satış için - tümünü satma)
    takeProfit = sellPrice * 1.05; // İlk hedefin %5 üstü (ikinci kısmi satış)
    
    // BUY & HOLD STRATEJİSİ İÇİN SİNYALLER
    
    // Fiyat konumu analizi (50 günlük aralık)
    const pricePosition = ((currentPrice - low50) / (high50 - low50)) * 100;
    
    if (pricePosition < 20) {
        signals.push('🟢 GÜÇLÜ ALIM FIRSATI: Fiyat 50 günlük aralığın en alt %20\'sinde - Ekleme zamanı!');
    } else if (pricePosition < 40) {
        signals.push('💚 İYİ ALIM FIRSATI: Fiyat düşük seviyelerde - Ekleme yapılabilir');
    } else if (pricePosition > 80) {
        signals.push('🔴 PAHALI BÖLGE: Fiyat 50 günlük aralığın en üst %20\'sinde - Kısmi satış düşünülebilir');
    } else if (pricePosition > 60) {
        signals.push('🟡 ORTA-YÜKSEK: Fiyat ortalama üzerinde - Yeni alım için beklenebilir');
    }
    
    // RSI bazlı sinyaller (uzun vade - daha katı)
    if (rsi < 30) {
        signals.push('📊 RSI ÇOK DÜŞÜK (' + rsi.toFixed(0) + ') - Aşırı satım bölgesi, güçlü ekleme fırsatı');
    } else if (rsi < 40) {
        signals.push('📊 RSI DÜŞÜK (' + rsi.toFixed(0) + ') - Ekleme yapılabilir');
    } else if (rsi > 70) {
        signals.push('📊 RSI YÜKSEK (' + rsi.toFixed(0) + ') - Aşırı alım, kısmi kar realizasyonu düşünülebilir');
    } else if (rsi > 60) {
        signals.push('📊 RSI ORTA-YÜKSEK (' + rsi.toFixed(0) + ') - Yeni alım için beklenebilir');
    }
    
    // EMA bazlı pozisyon analizi
    if (ema200 && currentPrice > ema200) {
        const distanceFromEma200 = ((currentPrice - ema200) / ema200) * 100;
        if (distanceFromEma200 > 15) {
            signals.push('⚠️ EMA200\'den %' + distanceFromEma200.toFixed(1) + ' uzakta - Pahalı bölge, düzeltme beklenebilir');
        } else {
            signals.push('✅ EMA200 üzerinde - Sağlam yükseliş trendi');
        }
    } else if (ema200 && currentPrice < ema200) {
        const distanceToEma200 = ((ema200 - currentPrice) / currentPrice) * 100;
        if (distanceToEma200 > 10) {
            signals.push('🎯 EMA200\'e %' + distanceToEma200.toFixed(1) + ' mesafede - Güçlü ekleme fırsatı!');
        } else {
            signals.push('📉 EMA200 altında - Dikkatli olunmalı, ancak yakında ekleme fırsatı olabilir');
        }
    }
    
    // Golden Cross / Death Cross kontrol
    if (ema50 && ema200) {
        const ema50Prev = calculateEMA(closes.slice(0, -10), 50);
        const ema200Prev = calculateEMA(closes.slice(0, -10), 200);
        if (ema50 > ema200 && ema50Prev <= ema200Prev) {
            signals.push('🌟 GOLDEN CROSS OLUŞTU! - Uzun vadeli yükseliş trendi başladı, pozisyon büyütülebilir');
        } else if (ema50 < ema200 && ema50Prev >= ema200Prev) {
            signals.push('💀 DEATH CROSS OLUŞTU! - Uzun vadeli düşüş riski, dikkatli olunmalı');
        }
    }
    
    // MACD momentum analizi
    if (macd && macd.histogram > 0 && macd.macd > 0) {
        signals.push('� MACD Güçlü Pozitif - Momentum yükselişte, trend devam edebilir');
    } else if (macd && macd.histogram < 0 && macd.macd < 0) {
        signals.push('� MACD Negatif - Düşüş baskısı var, destek seviyelerini izleyin');
    }
    
    return {
        currentPrice: currentPrice,
        indicators: {
            ema50: ema50,
            ema100: ema100,
            ema200: ema200,
            rsi: rsi,
            macd: macd,
            bollingerBands: bb,
            supportResistance: sr,
            high50: high50,
            low50: low50,
            pricePosition: pricePosition
        },
        signals: {
            overall: longTermTrend,
            trendStrength: trendStrength,
            messages: signals
        },
        recommendations: {
            buyPrice: buyPrice,
            buyReason: buyReason.join(', '),
            sellPrice: sellPrice,
            sellReason: sellReason.join(', '),
            stopLoss: stopLoss,
            takeProfit: takeProfit,
            riskRewardRatio: ((sellPrice - buyPrice) / (buyPrice - stopLoss)).toFixed(2)
        }
    };
}

// ============================================
// CACHE VE VERİ ÇEKME FONKSİYONLARI
// ============================================

function getCached(symbol) {
    const entry = cache.get(symbol);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
        cache.delete(symbol);
        return null;
    }
    return entry.data;
}

function setCached(symbol, data) {
    cache.set(symbol, { timestamp: Date.now(), data });
}

// Yahoo Finance Chart API - 1 dakikalık barlar ile pre/post market verileri
async function fetchYahooData(symbol) {
    return new Promise((resolve, reject) => {
        const chartPath = `/v8/finance/chart/${symbol}?range=1d&interval=1m&includePrePost=true&includeAdjustedClose=true&events=div%2Csplit&useYfid=true&lang=en-US&region=US&corsDomain=finance.yahoo.com`;

        const options = {
            hostname: 'query1.finance.yahoo.com',
            path: chartPath,
            method: 'GET',
            rejectUnauthorized: false,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://finance.yahoo.com/',
                'Origin': 'https://finance.yahoo.com'
            }
        };

        https.get(options, (res) => {
            if (res.statusCode !== 200) {
                return reject(new Error(`Yahoo API error: ${res.statusCode}`));
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

// Yahoo Finance Chart API - Günlük barlar (uzun vadeli analiz için)
async function fetchYahooHistoricalData(symbol) {
    return new Promise((resolve, reject) => {
        // 1 yıllık günlük veri (teknik analiz için yeterli)
        const chartPath = `/v8/finance/chart/${symbol}?range=1y&interval=1d&includeAdjustedClose=true&events=div%2Csplit&useYfid=true&lang=en-US&region=US&corsDomain=finance.yahoo.com`;

        const options = {
            hostname: 'query1.finance.yahoo.com',
            path: chartPath,
            method: 'GET',
            rejectUnauthorized: false,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://finance.yahoo.com/',
                'Origin': 'https://finance.yahoo.com'
            }
        };

        https.get(options, (res) => {
            if (res.statusCode !== 200) {
                return reject(new Error(`Yahoo Historical API error: ${res.statusCode}`));
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

async function getStockData(symbol) {
    // Cache check
    const cached = getCached(symbol);
    if (cached) return cached;

    try {
        // Chart API'den tam veriyi çek (Quote API kaldırıldı - çok sık hata veriyor)
        const data = await fetchYahooData(symbol);
        
        if (data && data.chart && data.chart.result && data.chart.result[0]) {
            const chartResult = data.chart.result[0];
            const meta = chartResult.meta;
            
            // Chart barlarından pre/post türet
            const timestamps = chartResult.timestamp;
            const indicators = chartResult.indicators?.quote?.[0];
            
            if (meta && Array.isArray(timestamps) && indicators?.close) {
                const preStart = 8 * 60;        // 08:00 UTC
                const preEnd = 13 * 60 + 30;    // 13:30 UTC
                const postStart = 20 * 60;      // 20:00 UTC
                const postEnd = 24 * 60;        // 24:00 UTC
                
                let lastPreClose, lastPostClose;
                
                for (let i = 0; i < timestamps.length; i++) {
                    const ts = timestamps[i] * 1000;
                    const d = new Date(ts);
                    const m = d.getUTCMinutes() + d.getUTCHours() * 60;
                    const closeVal = indicators.close[i];
                    
                    if (closeVal == null) continue;
                    
                    if (m >= preStart && m < preEnd) {
                        lastPreClose = closeVal;
                    } else if (m >= postStart && m < postEnd) {
                        lastPostClose = closeVal;
                    }
                }
                
                // Türetilmiş değerleri meta'ya ekle
                if (meta.preMarketPrice === undefined && lastPreClose !== undefined) {
                    meta.derivedPreMarketPrice = lastPreClose;
                    console.log(`${symbol}: Pre-market türetildi: ${lastPreClose.toFixed(2)}`);
                }
                
                if (meta.postMarketPrice === undefined && lastPostClose !== undefined) {
                    meta.derivedPostMarketPrice = lastPostClose;
                    console.log(`${symbol}: Post-market türetildi: ${lastPostClose.toFixed(2)}`);
                }
                
                // TEKNİK ANALİZ EKLE (UZUN VADELİ - GÜNLÜK VERİ)
                try {
                    // Günlük veri çek (1 yıllık)
                    const historicalData = await fetchYahooHistoricalData(symbol);
                    
                    if (historicalData?.chart?.result?.[0]) {
                        const histResult = historicalData.chart.result[0];
                        const histTimestamps = histResult.timestamp;
                        const histIndicators = histResult.indicators?.quote?.[0];
                        
                        if (histIndicators && histTimestamps && histTimestamps.length >= 200) {
                            // OHLC verilerini hazırla (günlük)
                            const validIndices = [];
                            for (let i = 0; i < histTimestamps.length; i++) {
                                if (histIndicators.close[i] != null && histIndicators.high[i] != null && 
                                    histIndicators.low[i] != null && histIndicators.open[i] != null) {
                                    validIndices.push(i);
                                }
                            }
                            
                            if (validIndices.length >= 200) {
                                const ohlcData = {
                                    timestamps: validIndices.map(i => histTimestamps[i]),
                                    opens: validIndices.map(i => histIndicators.open[i]),
                                    highs: validIndices.map(i => histIndicators.high[i]),
                                    lows: validIndices.map(i => histIndicators.low[i]),
                                    closes: validIndices.map(i => histIndicators.close[i]),
                                    volumes: validIndices.map(i => histIndicators.volume?.[i] || 0)
                                };
                                
                                const technicalAnalysis = performTechnicalAnalysis(ohlcData);
                                if (technicalAnalysis) {
                                    meta.technicalAnalysis = technicalAnalysis;
                                    console.log(`${symbol}: Teknik analiz tamamlandı - Trend: ${technicalAnalysis.signals.overall} (${validIndices.length} günlük veri)`);
                                }
                            }
                        }
                    }
                } catch (taError) {
                    console.error(`${symbol}: Teknik analiz hatası:`, taError.message);
                }
            }
            
            setCached(symbol, data);
            return data;
        }
    } catch (e) {
        console.error(`${symbol}: Yahoo provider error:`, e.message);
    }
    
    return null;
}

const server = http.createServer((req, res) => {
    // API isteği için proxy
    if (req.url.startsWith('/api/stock/')) {
        const symbol = req.url.split('/')[3];
        getStockData(symbol).then(data => {
            if (!data) {
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Data fetch failed' }));
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
        }).catch(err => {
            console.error('Provider error', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal provider error' }));
        });
        return;
    }

    // Statik dosya sunumu (HTML, CSS, JS)
    let filePath = '.' + req.url;
    if (filePath === './') {
        filePath = './index.html';
    }
    const extname = String(path.extname(filePath)).toLowerCase();
    const mimeTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            res.writeHead(404);
            res.end('404: File Not Found');
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

server.listen(PORT, () => {
    console.log(`Sunucu http://localhost:${PORT} adresinde çalışıyor.`);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`HATA: Port ${PORT} zaten kullanılıyor. Lütfen terminali kapatıp tekrar deneyin veya server.js dosyasındaki PORT numarasını değiştirin.`);
    } else {
        console.error('Sunucu hatası:', err);
    }
});