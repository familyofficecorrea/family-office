// ═══════════════════════════════════════════════════════════════════════════
//  Family Office — Dashboard com Cotações em Tempo Real
//  Motor: yfinance via Flask API local (porta 5000)
// ═══════════════════════════════════════════════════════════════════════════

const API_BASE = '/api';

// Theme Manager
let currentTheme = localStorage.getItem('theme') || 'dark';
if (currentTheme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
}

let labels = [];
let cdiData = [];
let portfolioData = [];
let principalData = [];

// ─── Assets Structure ────────────────────────────────────────────────────────
// Novo schema:
// {
//   id, ticker, name, quantity, avgPrice, value (quantity*avgPrice),
//   currentPrice, simulatedCurrent (quantity*currentPrice),
//   category, firstDate, lastDate
// }

// Assets carregados do servidor (centralizado)
let assets = [];
let _knownVersion = -1;  // Versão conhecida para polling

let real_estate = [];
let _knownReVersion = -1;

// ─── Migração de assets legados ──────────────────────────────────────────────
function migrateAsset(a) {
    if (a.ticker && a.quantity !== undefined) return a; // Já migrado

    // Tenta inferir ticker do nome
    const name = (a.name || '').toUpperCase();
    let ticker = '';
    
    // Match conhecidos
    if (name.includes('PETR4')) ticker = 'PETR4.SA';
    else if (name.includes('VALE3')) ticker = 'VALE3.SA';
    else if (name.includes('HGLG')) ticker = 'HGLG11.SA';
    else if (name.includes('MXRF')) ticker = 'MXRF11.SA';
    else if (name.includes('CDB') || name.includes('RENDA FIXA') || name.includes('TESOURO')) ticker = a.name; // Manter como está
    else ticker = a.name;

    const value = a.value || 0;
    const simulatedCurrent = a.simulatedCurrent || value;
    
    // Para renda variável, tentaremos buscar o preço real depois
    // Por agora, estima quantity baseado no preço aportado / valor simulado
    let quantity = 1;
    let avgPrice = value;
    
    if (simulatedCurrent > 0 && value > 0) {
        // Se o valor aportado e o simulado diferem, inferir proporção
        const currentPriceEstimate = simulatedCurrent;
        quantity = 1;
        avgPrice = value;
    }

    return {
        ...a,
        ticker: ticker,
        quantity: quantity,
        avgPrice: avgPrice,
        value: value,
        currentPrice: simulatedCurrent,
        simulatedCurrent: simulatedCurrent
    };
}

const saveAssets = async () => {
    // Salva no servidor (centralizado para todos os dispositivos)
    try {
        const res = await fetch(`${API_BASE}/assets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assets }),
            signal: AbortSignal.timeout(5000)
        });
        const data = await res.json();
        if (data.version) _knownVersion = data.version;
    } catch (e) {
        console.warn('Erro ao salvar ativos no servidor:', e);
    }
};

// ─── Carregar ativos do servidor ─────────────────────────────────────────────
async function loadAssetsFromServer() {
    try {
        const res = await fetch(`${API_BASE}/assets`, { signal: AbortSignal.timeout(5000) });
        const data = await res.json();
        if (data.assets) {
            assets = data.assets;
            _knownVersion = data.version;
            return true;
        }
    } catch (e) {
        console.warn('Erro ao carregar ativos do servidor:', e);
    }
    return false;
}

// ─── Real Estate Network ─────────────────────────────────────────────────────
const saveRealEstate = async () => {
    try {
        const res = await fetch(`${API_BASE}/real_estate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ real_estate }),
            signal: AbortSignal.timeout(5000)
        });
        const data = await res.json();
        if (data.version) _knownReVersion = data.version;
    } catch (e) {
        console.warn('Erro ao salvar imoveis no servidor:', e);
    }
};

async function loadRealEstateFromServer() {
    try {
        const res = await fetch(`${API_BASE}/real_estate`, { signal: AbortSignal.timeout(5000) });
        const data = await res.json();
        if (data.real_estate) {
            real_estate = data.real_estate;
            _knownReVersion = data.version;
            return true;
        }
    } catch (e) {
        console.warn('Erro ao carregar imoveis do servidor:', e);
    }
    return false;
}

// ─── Polling: sincronizar entre dispositivos ─────────────────────────────────
async function pollForUpdates() {
    try {
        const res = await fetch(`${API_BASE}/assets/version`, { signal: AbortSignal.timeout(3000) });
        const data = await res.json();
        if (data.version !== _knownVersion) {
            // Dados mudaram em outro dispositivo — recarregar
            console.log(`[SYNC] Versão mudou: ${_knownVersion} → ${data.version}. Recarregando...`);
            const loaded = await loadAssetsFromServer();
            if (loaded) {
                refreshUI();
            }
        }
    } catch (e) { /* Servidor offline, ignora */ }
    
    // Poll Real Estate API
    try {
        const resRe = await fetch(`${API_BASE}/real_estate/version`, { signal: AbortSignal.timeout(3000) });
        const dataRe = await resRe.json();
        if (dataRe.version !== _knownReVersion) {
            const loadedRe = await loadRealEstateFromServer();
            if (loadedRe && typeof updateRealEstateUI === 'function') updateRealEstateUI();
        }
    } catch (e) {}
}

// ─── Atualizar toda a UI de uma vez ──────────────────────────────────────────
function refreshUI() {
    if (typeof buildChartSeries === 'function') buildChartSeries();
    if (typeof filterChartData === 'function') filterChartData();
    if (typeof updateAssetListUI === 'function') updateAssetListUI();
    if (typeof updateMeusAtivosUI === 'function') updateMeusAtivosUI();
    if (typeof updateDetailedPortfolioUI === 'function') updateDetailedPortfolioUI();
    if (typeof updateTotalEquity === 'function') updateTotalEquity();
    if (typeof updateRentabilitySummary === 'function') updateRentabilitySummary();
    if (typeof updateRealEstateUI === 'function') updateRealEstateUI();
}

// ─── Live Reload: detecta mudanças nos arquivos de código ────────────────────
let _knownFilesHash = null;

async function pollForCodeChanges() {
    try {
        const res = await fetch(`${API_BASE}/files/version`, { signal: AbortSignal.timeout(3000) });
        const data = await res.json();
        if (_knownFilesHash === null) {
            // Primeira checagem — apenas registra o hash atual
            _knownFilesHash = data.hash;
        } else if (data.hash !== _knownFilesHash) {
            console.log(`[LIVE RELOAD] Código atualizado! Recarregando...`);
            location.reload();
        }
    } catch (e) { /* Servidor offline, ignora */ }
}

let allocationChart = null;
let apiOnline = false;

// ─── Utilities ───────────────────────────────────────────────────────────────
const formatCurrency = (value) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
};

const formatDate = (dateString) => {
    const [year, month, day] = dateString.split('-');
    return `${day}/${month}/${year}`;
};

// ─── API Helpers ─────────────────────────────────────────────────────────────
async function checkAPIHealth() {
    try {
        const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
            apiOnline = true;
            updateStatusIndicator(true);
            return true;
        }
    } catch (e) { /* API offline */ }
    apiOnline = false;
    updateStatusIndicator(false);
    return false;
}

function updateStatusIndicator(online) {
    const el = document.getElementById('api-status');
    if (!el) return;
    if (online) {
        el.className = 'status-online';
        el.textContent = 'Online';
    } else {
        el.className = 'status-offline';
        el.textContent = 'Offline';
    }
}

async function searchTickers(query) {
    if (!apiOnline || query.length < 2) return [];
    try {
        const res = await fetch(`${API_BASE}/search/${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(5000) });
        const data = await res.json();
        return data.results || [];
    } catch (e) {
        console.warn('Search API error:', e);
        return [];
    }
}

async function getQuote(ticker) {
    if (!apiOnline) return null;
    try {
        const res = await fetch(`${API_BASE}/quote/${encodeURIComponent(ticker)}`, { signal: AbortSignal.timeout(8000) });
        const data = await res.json();
        if (data.success) return data;
    } catch (e) {
        console.warn('Quote API error:', e);
    }
    return null;
}

async function getBulkQuotes(tickers) {
    if (!apiOnline || tickers.length === 0) return {};
    try {
        const res = await fetch(`${API_BASE}/quotes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tickers }),
            signal: AbortSignal.timeout(30000)
        });
        const data = await res.json();
        return data.quotes || {};
    } catch (e) {
        console.warn('Bulk quotes API error:', e);
        return {};
    }
}

// ─── Refresh All Quotes ──────────────────────────────────────────────────────
async function refreshAllQuotes() {
    const btn = document.getElementById('btn-refresh-quotes');
    if (btn) {
        btn.classList.add('loading');
        btn.disabled = true;
    }

    // Identifica tickers de renda variável (que têm .SA, -, etc.)
    const realTickers = assets
        .filter(a => isRealTicker(a.ticker))
        .map(a => a.ticker);

    if (realTickers.length > 0 && apiOnline) {
        const quotes = await getBulkQuotes(realTickers);
        
        assets.forEach(a => {
            const q = quotes[a.ticker.toUpperCase()];
            if (q && q.success && q.price > 0) {
                a.currentPrice = q.price;
                a.simulatedCurrent = a.quantity * q.price;
                a.name = q.name || a.name;
                if (q.price1MonthAgo) {
                    a.price1MonthAgo = q.price1MonthAgo;
                }
            }
        });
        
        saveAssets();
    }

    // Atualiza todo o UI
    buildChartSeries();
    filterChartData();
    updateAssetListUI();
    updateMeusAtivosUI();
    updateDetailedPortfolioUI();
    updateTotalEquity();
    if (typeof updateRentabilitySummary === 'function') updateRentabilitySummary();

    if (btn) {
        btn.classList.remove('loading');
        btn.disabled = false;
    }
}

function isRealTicker(ticker) {
    if (!ticker) return false;
    // Considera real se tem .SA, contém um ponto, ou tem - (ex: BTC-USD)
    return ticker.includes('.') || ticker.includes('-') || /^[A-Z]{4}\d{1,2}$/.test(ticker);
}

// ─── Initialization ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {

    // Theme setup
    const themeBtn = document.getElementById('theme-toggle');
    const themeIcon = themeBtn.querySelector('i');
    if (currentTheme === 'light') {
        themeIcon.className = 'fa-solid fa-moon'; // No tema claro mostra a lua para trocar pro escuro
    } else {
        themeIcon.className = 'fa-solid fa-sun';
    }

    themeBtn.addEventListener('click', () => {
        currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
        if (currentTheme === 'light') {
            document.documentElement.setAttribute('data-theme', 'light');
            themeIcon.className = 'fa-solid fa-moon';
        } else {
            document.documentElement.removeAttribute('data-theme');
            themeIcon.className = 'fa-solid fa-sun';
        }
        localStorage.setItem('theme', currentTheme);
        if (window.updateChartTheme) window.updateChartTheme();
    });

    // Tabs Logic
    const menuItems = document.querySelectorAll('.menu-item[data-tab]');
    const tabContents = document.querySelectorAll('.tab-content');
    
    menuItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const target = item.getAttribute('data-tab');
            menuItems.forEach(m => m.classList.remove('active'));
            tabContents.forEach(tc => tc.classList.remove('active'));
            item.classList.add('active');
            const targetTab = document.getElementById(target);
            if (targetTab) targetTab.classList.add('active');
        });
    });

    const safeTodayForChart = new Date();
    const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    
    // ─── Build Chart Series ──────────────────────────────────────────────
    window.buildChartSeries = () => {
        labels.length = 0;
        cdiData.length = 0;
        portfolioData.length = 0;
        principalData.length = 0;
        
        if(assets.length === 0) {
            labels.push(`${monthNames[safeTodayForChart.getMonth()]}/${String(safeTodayForChart.getFullYear()).slice(2)}`);
            cdiData.push(0);
            portfolioData.push(0);
            principalData.push(0);
            return;
        }
        
        const events = [...assets].sort((a,b) => new Date(a.firstDate) - new Date(b.firstDate));
        const startDate = new Date(events[0].firstDate);
        
        let currentCDI = 0;
        let currentPort = 0;
        let currentPrincipal = 0;
        
        let iterDate = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
        const endDate = new Date(safeTodayForChart.getFullYear(), safeTodayForChart.getMonth(), 1);
        
        while(iterDate <= endDate) {
            labels.push(`${monthNames[iterDate.getMonth()]}/${String(iterDate.getFullYear()).slice(2)}`);
            
            if(currentCDI > 0) currentCDI *= 1.0085;
            if(currentPort > 0) currentPort *= 1 + (Math.random() * 0.02 - 0.005);
            
            let monthlyDeposit = 0;
            events.forEach(ev => {
                const evD = new Date(ev.firstDate);
                if(evD.getFullYear() === iterDate.getFullYear() && evD.getMonth() === iterDate.getMonth()) {
                    monthlyDeposit += ev.value;
                }
            });
            
            currentCDI += monthlyDeposit;
            currentPort += monthlyDeposit;
            currentPrincipal += monthlyDeposit;
            
            cdiData.push(currentCDI - currentPrincipal);
            portfolioData.push(currentPort - currentPrincipal);
            principalData.push(currentPrincipal);
            
            iterDate.setMonth(iterDate.getMonth() + 1);
        }
    };
    buildChartSeries();

    // ─── Chart Initialization ────────────────────────────────────────────
    const ctx = document.getElementById('growthChart').getContext('2d');
    
    const gradientPortfolio = ctx.createLinearGradient(0, 0, 0, 400);
    gradientPortfolio.addColorStop(0, 'rgba(0, 200, 83, 0.4)');
    gradientPortfolio.addColorStop(1, 'rgba(0, 200, 83, 0.0)');

    const gradientCDI = ctx.createLinearGradient(0, 0, 0, 400);
    gradientCDI.addColorStop(0, 'rgba(41, 98, 255, 0.2)');
    gradientCDI.addColorStop(1, 'rgba(41, 98, 255, 0.0)');

    window.growthChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Minha Carteira',
                    data: portfolioData,
                    borderColor: '#00C853',
                    backgroundColor: gradientPortfolio,
                    borderWidth: 3,
                    pointBackgroundColor: '#0B0E14',
                    pointBorderColor: '#00C853',
                    pointBorderWidth: 2,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    fill: true,
                    tension: 0.4
                },
                {
                    label: 'CDI (Referência)',
                    data: cdiData,
                    borderColor: '#2962FF',
                    backgroundColor: gradientCDI,
                    borderWidth: 2,
                    borderDash: [5, 5],
                    pointBackgroundColor: '#0B0E14',
                    pointBorderColor: '#2962FF',
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    fill: true,
                    tension: 0.4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: '#9BA1A6',
                        usePointStyle: true,
                        boxWidth: 8
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(19, 23, 34, 0.9)',
                    titleColor: '#FFFFFF',
                    bodyColor: '#FFFFFF',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: true,
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) label += ': ';
                            if (context.parsed.y !== null) {
                                const val = context.parsed.y;
                                label += formatCurrency(val);
                                if (context.chart.data.principalSliced) {
                                    const principal = context.chart.data.principalSliced[context.dataIndex];
                                    if (principal && principal > 0) {
                                        const perc = (val / principal) * 100;
                                        const sign = perc > 0 ? '+' : '';
                                        label += ` (${sign}${perc.toFixed(2)}%)`;
                                    }
                                }
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false, drawBorder: false },
                    ticks: { color: '#9BA1A6', font: { family: "'Inter', sans-serif", size: 11 } }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false },
                    ticks: {
                        color: '#9BA1A6',
                        font: { family: "'Inter', sans-serif", size: 11 },
                        callback: function(value) {
                            if (Math.abs(value) >= 1000) return 'R$ ' + (value / 1000).toFixed(1) + 'k';
                            return 'R$ ' + value;
                        }
                    }
                }
            },
            interaction: { intersect: false, mode: 'index' },
        }
    });

    // ─── Chart Date Filters ──────────────────────────────────────────────
    const startDateInput = document.getElementById('chart-start-date');
    const endDateInput = document.getElementById('chart-end-date');
    
    const todayStr = safeTodayForChart.toISOString().split('T')[0];
    startDateInput.value = `${safeTodayForChart.getFullYear()}-01-01`;
    endDateInput.value = todayStr;
    
    window.filterChartData = () => {
        const sDate = startDateInput.valueAsDate || new Date(`${safeTodayForChart.getFullYear()}-01-01`);
        const eDate = endDateInput.valueAsDate || safeTodayForChart;
        
        const toMonthIndex = (d) => {
            if(assets.length === 0) return 0;
            const events = [...assets].sort((a,b) => new Date(a.firstDate) - new Date(b.firstDate));
            const startD = new Date(events[0].firstDate);
            return (d.getFullYear() - startD.getFullYear()) * 12 + d.getMonth() - startD.getMonth();
        };
        
        let sIdx = Math.max(0, toMonthIndex(sDate));
        let eIdx = Math.min(labels.length - 1, toMonthIndex(eDate));
        
        if (sIdx >= eIdx) { eIdx = Math.min(labels.length - 1, sIdx + 1); }
        if (sIdx >= labels.length) { sIdx = labels.length - 2; eIdx = labels.length - 1; }
        
        window.growthChart.data.labels = labels.slice(sIdx, eIdx + 1);
        window.growthChart.data.datasets[0].data = portfolioData.slice(sIdx, eIdx + 1);
        window.growthChart.data.datasets[1].data = cdiData.slice(sIdx, eIdx + 1);
        window.growthChart.data.principalSliced = principalData.slice(sIdx, eIdx + 1);
        window.growthChart.update();
        if (typeof validateActiveButton === 'function') validateActiveButton();
    };

    startDateInput.addEventListener('change', filterChartData);
    endDateInput.addEventListener('change', filterChartData);
    
    // Quick filters
    const quickFilters = document.querySelectorAll('#quick-filters .btn-filter');
    
    window.updateChartTheme = function() {
        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        const color = isLight ? '#8B909A' : '#9BA1A6';
        const gridColor = isLight ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.05)';
        const tooltipBg = isLight ? 'rgba(255, 255, 255, 0.95)' : 'rgba(19, 23, 34, 0.9)';
        const tooltipBorder = isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)';
        const tooltipText = isLight ? '#2D3136' : '#FFFFFF';

        if (window.growthChart) {
            window.growthChart.options.plugins.legend.labels.color = color;
            window.growthChart.options.plugins.tooltip.backgroundColor = tooltipBg;
            window.growthChart.options.plugins.tooltip.titleColor = tooltipText;
            window.growthChart.options.plugins.tooltip.bodyColor = tooltipText;
            window.growthChart.options.plugins.tooltip.borderColor = tooltipBorder;
            window.growthChart.options.scales.x.ticks.color = color;
            window.growthChart.options.scales.y.ticks.color = color;
            window.growthChart.options.scales.y.grid.color = gridColor;
            window.growthChart.update();
        }

        if (allocationChart) {
            allocationChart.options.plugins.legend.labels.color = color;
            allocationChart.options.plugins.tooltip.backgroundColor = tooltipBg;
            allocationChart.options.plugins.tooltip.titleColor = tooltipText;
            allocationChart.options.plugins.tooltip.bodyColor = tooltipText;
            allocationChart.options.plugins.tooltip.borderColor = tooltipBorder;
            
            if (allocationChart.data && allocationChart.data.datasets.length > 0) {
                // A cor de borda do gráfico donut (para o espaço entre eles virar background)
                allocationChart.data.datasets[0].borderColor = isLight ? '#FFFFFF' : '#1C212E';
            }
            allocationChart.update();
        }
    };
    
    // Update theme as logo has mounted
    window.updateChartTheme();
    
    const formatDateForInput = (d) => {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    };

    const validateActiveButton = () => {
        quickFilters.forEach(b => b.classList.remove('active'));
    };

    quickFilters.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const range = e.target.getAttribute('data-range');
            let end = new Date(safeTodayForChart);
            let start = new Date(safeTodayForChart);
            
            switch(range) {
                case 'lastMonth': start.setMonth(start.getMonth() - 1); break;
                case '6M': start.setMonth(start.getMonth() - 6); break;
                case '12M': start.setMonth(start.getMonth() - 12); break;
                case 'lastYear': start = new Date(`${safeTodayForChart.getFullYear()-1}-01-01`); end = new Date(`${safeTodayForChart.getFullYear()-1}-12-31`); break;
                case 'thisYear': start = new Date(`${safeTodayForChart.getFullYear()}-01-01`); break;
                case 'all': start = new Date('2020-01-01'); break;
            }
            
            startDateInput.value = formatDateForInput(start);
            endDateInput.value = formatDateForInput(end);
            filterChartData();
            e.target.classList.add('active');
        });
    });

    filterChartData();

    // ─── Rentabilidade e CDI Reais ──────────────────────────────────────
    window.updateRentabilitySummary = () => {
        let totalVal = 0;
        let totalPastVal = 0;
        
        assets.forEach(a => {
            const invested = a.value || (a.quantity * a.avgPrice);
            const current = a.simulatedCurrent || invested;
            
            // Para as ações puxadas do Yahoo, temos o valor exato no dia 1 do mês passado
            // Para renda fixa manual (sem ticker online), assumimos que rendeu o CDI padrão
            // (Para simplificar e não distorcer, usamos o currentPrice para os manuais, 
            // significando variação zero no mês se o usuário não o atualizou manualmente)
            let pastMultiplier = a.price1MonthAgo || (a.currentPrice || a.avgPrice);
            let past = a.quantity * pastMultiplier;
            
            // Fallback
            if (!past || past === 0) past = current;
            
            totalVal += current;
            totalPastVal += past;
        });

        const profitElement = document.getElementById('month-profit');
        const iconElement = profitElement.parentElement.parentElement.querySelector('.card-icon');
        
        if (totalPastVal > 0) {
            const profitVal = totalVal - totalPastVal;
            const perc = (profitVal / totalPastVal) * 100;
            const sign = perc > 0 ? '+' : '';
            profitElement.innerHTML = `${sign}${formatCurrency(profitVal)} <span style="font-size: 14px; opacity: 0.8; font-weight: normal;">(${sign}${perc.toFixed(2)}%)</span>`;
            if (perc > 0) {
                iconElement.style.color = 'var(--accent-green)';
            } else if (perc < 0) {
                iconElement.style.color = '#FF3D57';
            } else {
                iconElement.style.color = '#9BA1A6';
            }
        } else {
            profitElement.innerHTML = '0.00% <span style="font-size: 14px; opacity: 0.8; font-weight: normal;">(R$ 0,00)</span>';
            iconElement.style.color = '#9BA1A6';
        }
    };

    window.fetchRealCDI = async () => {
        const cdiElement = document.getElementById('cdi-profit');
        try {
            // Consulta API Pública do BCB para a taxa CDI acumulada no último mês (Série 4391)
            const res = await fetch('https://api.bcb.gov.br/dados/serie/bcdata.sgs.4391/dados/ultimos/1?formato=json');
            const data = await res.json();
            if (data && data.length > 0 && data[0].valor) {
                cdiElement.innerText = `+${data[0].valor}%`;
            } else {
                cdiElement.innerText = '—';
            }
        } catch (e) {
            console.warn('Erro ao carregar BCB CDI:', e);
            cdiElement.innerText = '...';
        }
    };

    // Chamadas iniciais
    updateRentabilitySummary();
    fetchRealCDI();

    // ─── Autocomplete Logic ──────────────────────────────────────────────
    const tickerInput = document.getElementById('asset-ticker');
    
    // ─── Op Type Logic ─────────────────────────────────────────────
    const opRadios = document.querySelectorAll('input[name="asset-op-type"]');
    const reOriginContainer = document.getElementById('re-origin-container');
    const btnAddAsset = document.getElementById('btn-add-asset');
    opRadios.forEach(r => {
        r.addEventListener('change', (e) => {
            if (e.target.value === 'saque') {
                reOriginContainer.style.display = 'none';
                btnAddAsset.innerHTML = '<i class="fa-solid fa-right-from-bracket"></i> Registrar Saque';
                btnAddAsset.style.backgroundColor = '#FF3D57';
            } else {
                reOriginContainer.style.display = 'flex';
                btnAddAsset.innerHTML = '<i class="fa-solid fa-plus"></i> Registrar Aporte';
                btnAddAsset.style.backgroundColor = 'var(--accent-green)';
            }
        });
    });
    const dropdown = document.getElementById('autocomplete-dropdown');
    const spinner = document.getElementById('ticker-spinner');
    const selectedInfo = document.getElementById('selected-ticker-info');
    const tickerBadge = document.getElementById('ticker-badge');
    const tickerFullName = document.getElementById('ticker-full-name');
    const quantityInput = document.getElementById('asset-quantity');
    const execPriceInput = document.getElementById('asset-exec-price');
    const calcPreview = document.getElementById('calc-preview');
    const calcTotal = document.getElementById('calc-total');
    const calcCurrentPrice = document.getElementById('calc-current-price');
    
    let selectedTickerData = null;
    let debounceTimer = null;
    let highlightedIndex = -1;

    tickerInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        const query = tickerInput.value.trim();
        
        if (query.length < 2) {
            hideDropdown();
            return;
        }
        
        spinner.style.display = 'block';
        debounceTimer = setTimeout(async () => {
            const results = await searchTickers(query);
            spinner.style.display = 'none';
            
            if (results.length === 0) {
                dropdown.innerHTML = '<div class="autocomplete-no-results">Nenhum resultado encontrado</div>';
                showDropdown();
                return;
            }
            
            highlightedIndex = -1;
            dropdown.innerHTML = results.map((r, i) => `
                <div class="autocomplete-item" data-index="${i}" data-symbol="${r.symbol}" data-name="${r.name}" data-exchange="${r.exchange}">
                    <div class="autocomplete-item-left">
                        <span class="autocomplete-symbol">${r.symbol}</span>
                        <span class="autocomplete-name">${r.name}</span>
                    </div>
                    <span class="autocomplete-exchange">${r.exchange || r.type || ''}</span>
                </div>
            `).join('');
            
            // Click handlers
            dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
                item.addEventListener('click', () => selectTicker(item));
            });
            
            showDropdown();
        }, 350);
    });

    // Keyboard navigation
    tickerInput.addEventListener('keydown', (e) => {
        const items = dropdown.querySelectorAll('.autocomplete-item');
        if (!items.length) return;
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            highlightedIndex = Math.min(highlightedIndex + 1, items.length - 1);
            updateHighlight(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            highlightedIndex = Math.max(highlightedIndex - 1, 0);
            updateHighlight(items);
        } else if (e.key === 'Enter' && highlightedIndex >= 0) {
            e.preventDefault();
            selectTicker(items[highlightedIndex]);
        } else if (e.key === 'Escape') {
            hideDropdown();
        }
    });

    function updateHighlight(items) {
        items.forEach((item, i) => {
            item.classList.toggle('highlighted', i === highlightedIndex);
        });
    }

    async function selectTicker(item) {
        const symbol = item.dataset.symbol;
        const name = item.dataset.name;
        
        tickerInput.value = symbol;
        tickerBadge.textContent = symbol;
        tickerFullName.textContent = name;
        selectedInfo.style.display = 'flex';
        
        hideDropdown();
        
        // Buscar cotação atual
        selectedTickerData = { symbol, name };
        spinner.style.display = 'block';
        const quote = await getQuote(symbol);
        spinner.style.display = 'none';
        
        if (quote && quote.price > 0) {
            selectedTickerData.price = quote.price;
            selectedTickerData.previousClose = quote.previousClose;
            selectedTickerData.fullData = quote;
            calcCurrentPrice.textContent = formatCurrency(quote.price);
            
            // Se execPrice está vazio, preenche com preço atual
            if (!execPriceInput.value) {
                execPriceInput.value = quote.price.toFixed(2);
            }
            
            updateCalcPreview();
        }
        
        // Auto-categorizar
        const catSelect = document.getElementById('asset-category');
        if (quote && quote.type) {
            const t = (quote.type || '').toUpperCase();
            if (symbol.includes('11.SA')) catSelect.value = 'Fundos Imobiliários';
            else if (t === 'CRYPTOCURRENCY') catSelect.value = 'Criptoativos';
            else if (t === 'ETF') catSelect.value = 'Renda Variável';
            else if (t === 'EQUITY') {
                if (symbol.endsWith('.SA')) catSelect.value = 'Renda Variável';
                else catSelect.value = 'Exterior';
            }
        }
    }

    function showDropdown() { dropdown.classList.add('visible'); }
    function hideDropdown() { dropdown.classList.remove('visible'); highlightedIndex = -1; }

    // Esconder dropdown ao clicar fora
    document.addEventListener('click', (e) => {
        if (!tickerInput.contains(e.target) && !dropdown.contains(e.target)) {
            hideDropdown();
        }
    });

    // ─── Cálculo automático (Cotas × Preço) ─────────────────────────────
    function updateCalcPreview() {
        const qty = parseFloat(quantityInput.value) || 0;
        const price = parseFloat(execPriceInput.value) || 0;
        const total = qty * price;
        
        if (qty > 0 && price > 0) {
            calcPreview.style.display = 'block';
            calcTotal.textContent = formatCurrency(total);
        } else {
            calcPreview.style.display = 'none';
        }
    }

    quantityInput.addEventListener('input', updateCalcPreview);
    execPriceInput.addEventListener('input', updateCalcPreview);

    // ─── Form Submission ─────────────────────────────────────────────────
    const form = document.getElementById('add-asset-form');
    const assetList = document.getElementById('asset-list');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const ticker = tickerInput.value.trim().toUpperCase();
        const quantity = parseFloat(quantityInput.value);
        const execPrice = parseFloat(execPriceInput.value);
        const categoryInput = document.getElementById('asset-category');
        const dateInput = document.getElementById('asset-date');
        
        const opType = document.querySelector('input[name="asset-op-type"]:checked').value;
        const isReOrigin = document.getElementById('asset-re-origin')?.checked;
        
        if (!ticker || !quantity || !execPrice) return;
        
        const totalValue = quantity * execPrice;
        
        // Buscar preço atual se possível
        let currentPrice = execPrice;
        let price1MonthAgo = execPrice;
        let assetName = selectedTickerData?.name || ticker;
        
        if (apiOnline && isRealTicker(ticker)) {
            const quote = await getQuote(ticker);
            if (quote && quote.price > 0) {
                currentPrice = quote.price;
                assetName = quote.name || ticker;
                price1MonthAgo = quote.price1MonthAgo || currentPrice;
            }
        }
        
        const existingIndex = assets.findIndex(a => a.ticker && a.ticker.toUpperCase() === ticker);
        
        if (opType === 'saque') {
            if (existingIndex === -1) {
                alert('Ativo não encontrado para efetuar o saque.');
                return;
            }
            const existing = assets[existingIndex];
            if (existing.quantity < quantity) {
                alert('Quantidade insuficiente no portfólio para esse saque.');
                return;
            }
            const proportion = quantity / existing.quantity;
            
            // Lógica de "Preço Médio Gerencial / Breakeven"
            // Abate o valor total da venda do custo original da posição.
            // Se vender com lucro e tirar todo o risco, o PM pode zerar ou ficar negativo.
            // Se vender com prejuízo, o PM das cotas restantes sobe, pois precisam recuperar o prejuízo para a operação empatar.
            const oldTotalCost = existing.quantity * existing.avgPrice;
            const saleValue = quantity * execPrice;
            const newTotalCost = oldTotalCost - saleValue;

            existing.quantity -= quantity;
            
            if (existing.quantity > 0.000001) {
                existing.avgPrice = newTotalCost / existing.quantity;
            } else {
                existing.avgPrice = 0;
            }
            
            existing.value = newTotalCost; 
            existing.simulatedCurrent = existing.quantity * currentPrice;
            
            if (existing.reInvested) {
                // Remove proportionality of RE invested capital
                existing.reInvested = existing.reInvested * (1 - proportion);
            }
            
            if (existing.quantity <= 0.000001) {
                assets.splice(existingIndex, 1);
            }
        } else {
            if (existingIndex !== -1) {
                // Merge: preço médio ponderado
                const existing = assets[existingIndex];
                const totalQty = existing.quantity + quantity;
                const newAvgPrice = ((existing.quantity * existing.avgPrice) + (quantity * execPrice)) / totalQty;
                
                existing.quantity = totalQty;
                existing.avgPrice = newAvgPrice;
                existing.value = totalQty * newAvgPrice;
                existing.currentPrice = currentPrice;
                existing.simulatedCurrent = totalQty * currentPrice;
                existing.price1MonthAgo = price1MonthAgo;
                if (isReOrigin) {
                    existing.reInvested = (existing.reInvested || 0) + totalValue;
                }
                
                const newDateObj = new Date(dateInput.value);
                if (newDateObj > new Date(existing.lastDate)) existing.lastDate = dateInput.value;
                if (newDateObj < new Date(existing.firstDate)) existing.firstDate = dateInput.value;
            } else {
                assets.push({
                    id: Date.now(),
                    ticker: ticker,
                    name: assetName,
                    quantity: quantity,
                    avgPrice: execPrice,
                    value: totalValue,
                    currentPrice: currentPrice,
                    price1MonthAgo: price1MonthAgo,
                    simulatedCurrent: quantity * currentPrice,
                    category: categoryInput.value,
                    firstDate: dateInput.value,
                    lastDate: dateInput.value,
                    reInvested: isReOrigin ? totalValue : 0
                });
            }
        }

        saveAssets();
        buildChartSeries();
        filterChartData();
        updateAssetListUI();
        updateMeusAtivosUI();
        updateDetailedPortfolioUI();
        updateTotalEquity();
        if (typeof updateRentabilitySummary === 'function') updateRentabilitySummary();

        // Reset
        form.reset();
        selectedTickerData = null;
        selectedInfo.style.display = 'none';
        calcPreview.style.display = 'none';
        
        // Success feedback
        const btn = form.querySelector('.btn-primary');
        const originalText = btn.innerHTML;
        const originalBg = btn.style.backgroundColor;
        
        if (opType === 'saque') {
            btn.innerHTML = '<i class="fa-solid fa-check"></i> Saque Registrado!';
            btn.style.backgroundColor = '#FF3D57';
        } else {
            btn.innerHTML = '<i class="fa-solid fa-check"></i> Aporte Registrado!';
            btn.style.backgroundColor = 'var(--accent-green)';
        }
        
        setTimeout(() => { btn.innerHTML = originalText; btn.style.backgroundColor = originalBg; }, 2000);
    });

    // ─── Delete Asset ────────────────────────────────────────────────────
    window.deleteAsset = (id) => {
        const idx = assets.findIndex(a => a.id === id);
        if (idx > -1) {
            assets.splice(idx, 1);
            saveAssets();
            buildChartSeries();
            filterChartData();
            updateAssetListUI();
            updateMeusAtivosUI();
            updateDetailedPortfolioUI();
            updateTotalEquity();
            if (typeof updateRentabilitySummary === 'function') updateRentabilitySummary();
        }
    };

    // ─── Update Total Equity ─────────────────────────────────────────────
    window.updateTotalEquity = () => {
        const totalFinanceiro = assets.reduce((sum, a) => sum + (a.simulatedCurrent || a.value), 0);
        document.getElementById('total-equity').innerHTML = formatCurrency(totalFinanceiro);
    };

    // ─── UI Updates ──────────────────────────────────────────────────────
    const updateAssetListUI = () => {
        if (assets.length === 0) {
            assetList.innerHTML = '<li class="empty-state">Nenhum ativo cadastrado.</li>';
            return;
        }

        assetList.innerHTML = '';
        const sortedAssets = [...assets].reverse();

        sortedAssets.forEach(asset => {
            const li = document.createElement('li');
            li.className = 'asset-item';
            li.innerHTML = `
                <div>
                    <div class="asset-name">${asset.ticker || asset.name}</div>
                    <span class="asset-date">${asset.quantity ? asset.quantity + ' cotas' : ''} · ${formatDate(asset.lastDate)}</span>
                </div>
                <div class="asset-val">${formatCurrency(asset.simulatedCurrent || asset.value)}</div>
            `;
            assetList.appendChild(li);
        });
    };

    const updateDetailedPortfolioUI = () => {
        const tbody = document.getElementById('detailed-asset-list');
        if (!tbody) return;

        if (assets.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="empty-state" style="text-align: center; color: var(--text-secondary); padding: 20px;">Nenhum ativo adicionado ainda.</td></tr>`;
            return;
        }

        tbody.innerHTML = ''; 
        const sortedAssets = [...assets].sort((a, b) => (b.simulatedCurrent || b.value) - (a.simulatedCurrent || a.value));

        sortedAssets.forEach(asset => {
            const tr = document.createElement('tr');
            
            const invested = asset.value || (asset.quantity * asset.avgPrice);
            const current = asset.simulatedCurrent || invested;
            const profitValue = current - invested;
            const profitPercentage = invested > 0 ? (profitValue / invested) * 100 : 0;
            
            let pillClass = 'neutral';
            let formattedProfit = '0.00%';
            
            if (profitPercentage > 0.01) {
                pillClass = 'positive';
                formattedProfit = '+' + profitPercentage.toFixed(2) + '%';
            } else if (profitPercentage < -0.01) {
                pillClass = 'negative';
                formattedProfit = profitPercentage.toFixed(2) + '%';
            }
            
            const currentPriceDisplay = asset.currentPrice ? formatCurrency(asset.currentPrice) : '<span class="price-loading"></span>';
            
            tr.innerHTML = `
                <td style="font-weight: 600; color: #fff;">
                    <div>${asset.ticker || asset.name}</div>
                    <div style="font-size: 11px; color: var(--text-secondary); font-weight: 400; margin-top: 2px;">${asset.name !== asset.ticker ? asset.name : ''}</div>
                </td>
                <td style="color: var(--text-secondary);">${asset.quantity ? asset.quantity.toLocaleString('pt-BR') : '—'}</td>
                <td>${formatCurrency(asset.avgPrice || 0)}</td>
                <td>${formatCurrency(invested)}</td>
                <td>${currentPriceDisplay}</td>
                <td><span class="profit-pill ${pillClass}">${formattedProfit}</span></td>
                <td style="font-weight: 600; color: ${pillClass === 'positive' ? 'var(--accent-green)' : (pillClass === 'negative' ? '#FF3D57' : '#fff')}">${formatCurrency(current)}</td>
            `;
            tbody.appendChild(tr);
        });
    };

    const updateMeusAtivosUI = () => {
        const accordionContainer = document.getElementById('accordion-container');
        if (!accordionContainer) return;

        const categories = {};
        assets.forEach(asset => {
            const cat = asset.category || 'Outros';
            if (!categories[cat]) categories[cat] = [];
            categories[cat].push(asset);
        });

        if (assets.length === 0) {
            accordionContainer.innerHTML = '<div class="empty-state" style="padding: 20px; text-align: center; color: var(--text-secondary);">Nenhum ativo configurado.</div>';
            if (allocationChart) {
                allocationChart.data.labels = [];
                allocationChart.data.datasets[0].data = [];
                allocationChart.update();
            }
            return;
        }

        accordionContainer.innerHTML = '';
        
        const categoryColors = {
            'Renda Fixa': '#00C853',
            'Renda Variável': '#2962FF',
            'Fundos Imobiliários': '#FF3D57',
            'Exterior': '#FFA000',
            'Criptoativos': '#9C27B0',
            'Outros': '#9BA1A6'
        };

        const chartLabels = [];
        const chartData = [];
        const chartBackgrounds = [];

        Object.keys(categories).forEach(cat => {
            const catsAssets = categories[cat];
            const catTotalVal = catsAssets.reduce((sum, a) => sum + (a.simulatedCurrent || a.value), 0);
            
            chartLabels.push(cat);
            chartData.push(catTotalVal);
            chartBackgrounds.push(categoryColors[cat] || categoryColors['Outros']);
            
            const item = document.createElement('div');
            item.className = 'accordion-item';

            let rowsHtml = '';
            catsAssets.forEach(a => {
                const invested = a.value || (a.quantity * a.avgPrice);
                const current = a.simulatedCurrent || invested;
                const profitVal = current - invested;
                const profitPerc = invested > 0 ? (profitVal / invested) * 100 : 0;
                let color = '#fff';
                let sign = '';
                if(profitPerc > 0) { color = 'var(--accent-green)'; sign = '+'; }
                else if(profitPerc < 0) { color = '#FF3D57'; }
                
                rowsHtml += `
                    <div style="display: flex; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,0.05); align-items: center; background-color: var(--bg-primary);">
                        <div>
                            <span style="color: #fff; font-weight: 600;">${a.ticker || a.name}</span>
                            <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">${a.quantity ? a.quantity + ' cotas · PM: ' + formatCurrency(a.avgPrice) : ''}</div>
                        </div>
                        <div style="text-align: right;">
                            <span style="color: var(--text-secondary); font-size: 12px;">Rentabilidade</span><br>
                            <span style="font-size: 13px; color: ${color}; font-weight: 500;">${sign}${profitPerc.toFixed(2)}%</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 16px;">
                            <span style="min-width: 120px; text-align: right; color: ${color}; font-weight: 600;">${formatCurrency(current)}</span>
                            <button class="btn-delete-asset" data-id="${a.id}" style="background: none; border: none; color: #FF3D57; cursor: pointer; padding: 4px; transition: 0.2s;" title="Excluir Ativo">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        </div>
                    </div>
                `;
            });

            item.innerHTML = `
                <div class="accordion-header">
                    <div class="accordion-title">
                        <div class="cat-indicator" style="background-color: ${categoryColors[cat] || categoryColors['Outros']}"></div>
                        ${cat}
                    </div>
                    <div class="accordion-stats">
                        <span style="font-weight: 600; color: #fff;">${formatCurrency(catTotalVal)}</span>
                        <i class="fa-solid fa-chevron-down" style="color: var(--text-secondary); transition: 0.3s;"></i>
                    </div>
                </div>
                <div class="accordion-body">
                    ${rowsHtml}
                </div>
            `;
            
            const header = item.querySelector('.accordion-header');
            header.addEventListener('click', () => { item.classList.toggle('active'); });
            
            accordionContainer.appendChild(item);

            const deleteBtns = item.querySelectorAll('.btn-delete-asset');
            deleteBtns.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const idToDelete = parseInt(btn.getAttribute('data-id'));
                    if (window.deleteAsset) window.deleteAsset(idToDelete);
                });
            });
        });

        // Doughnut Chart
        const doughnutCtx = document.getElementById('allocationChart');
        if(allocationChart) {
            allocationChart.data.labels = chartLabels;
            allocationChart.data.datasets[0].data = chartData;
            allocationChart.data.datasets[0].backgroundColor = chartBackgrounds;
            allocationChart.update();
        } else if(doughnutCtx) {
            allocationChart = new Chart(doughnutCtx.getContext('2d'), {
                type: 'doughnut',
                data: {
                    labels: chartLabels,
                    datasets: [{
                        data: chartData,
                        backgroundColor: chartBackgrounds,
                        borderWidth: 0,
                        hoverOffset: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '75%',
                    plugins: {
                        legend: { position: 'right', labels: { color: '#9BA1A6', usePointStyle: true, boxWidth: 8, padding: 20 } },
                        tooltip: { backgroundColor: 'rgba(19, 23, 34, 0.9)', titleColor: '#FFFFFF', bodyColor: '#FFFFFF', padding: 12,
                            callbacks: {
                                label: function(context) {
                                    const val = context.parsed;
                                    return ' ' + formatCurrency(val);
                                }
                            }
                        }
                    }
                }
            });
        }
    };

    // ─── Refresh Button ──────────────────────────────────────────────────
    const refreshBtn = document.getElementById('btn-refresh-quotes');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', refreshAllQuotes);
    }

    // ─── Real Estate Property Management ────────────────────────────────────────
    let _currentBuildingId = null; // Currently opened building detail
    let _currentUnitFilter = 'all';

    window.deleteBuilding = (id, e) => {
        if (e) { e.stopPropagation(); e.preventDefault(); }
        if (confirm("Deseja realmente excluir este imóvel e todas as suas unidades?")) {
            real_estate = real_estate.filter(r => r.id !== id);
            saveRealEstate();
            if (_currentBuildingId === id) {
                closeBuildingDetail();
            }
            updateRealEstateUI();
        }
    };

    window.openBuildingDetail = (buildingId) => {
        _currentBuildingId = buildingId;
        _currentUnitFilter = 'all';

        // Hide main grid, show detail panel
        document.getElementById('re-buildings-grid').style.display = 'none';
        document.querySelector('#imobiliaria > .section-header').style.display = 'none';

        const detailPanel = document.getElementById('building-detail-panel');
        detailPanel.style.display = 'block';

        // Reset filter buttons
        document.querySelectorAll('.detail-panel-filters .btn-filter').forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-unit-filter') === 'all');
        });

        renderBuildingDetail();
    };

    window.closeBuildingDetail = () => {
        _currentBuildingId = null;
        document.getElementById('re-buildings-grid').style.display = 'grid';
        document.querySelector('#imobiliaria > .section-header').style.display = 'flex';
        document.getElementById('building-detail-panel').style.display = 'none';
        updateRealEstateUI(); // refresh cards
    };

    window.filterUnits = (filter, btn) => {
        _currentUnitFilter = filter;
        document.querySelectorAll('.detail-panel-filters .btn-filter').forEach(b => b.classList.remove('active'));
        if (btn) btn.classList.add('active');
        renderBuildingDetail();
    };

    window.openAddUnitModal = () => {
        document.getElementById('add-unit-label').value = '';
        document.getElementById('add-unit-status').value = 'disponivel';
        document.getElementById('modal-add-unit').classList.add('visible');
    };

    window.openEditBuildingModal = () => {
        const building = real_estate.find(b => b.id === _currentBuildingId);
        if (!building) return;
        document.getElementById('edit-building-id').value = building.id;
        document.getElementById('edit-building-name').value = building.name || '';
        document.getElementById('edit-building-address').value = building.address || '';
        document.getElementById('modal-edit-building').classList.add('visible');
    };

    window.editUnit = (buildingId, unitId) => {
        const building = real_estate.find(b => b.id === buildingId);
        if (!building) return;
        const unit = building.units.find(u => u.id === unitId);
        if (!unit) return;

        document.getElementById('edit-unit-building-id').value = buildingId;
        document.getElementById('edit-unit-id').value = unitId;
        document.getElementById('edit-unit-label').value = unit.label;
        document.getElementById('edit-unit-status').value = unit.status;
        document.getElementById('edit-unit-rent').value = unit.rentValue || '';
        document.getElementById('edit-unit-rent-start').value = unit.rentStartDate || '';
        document.getElementById('edit-unit-sale').value = unit.saleValue || '';
        document.getElementById('edit-unit-sale-date').value = unit.saleDate || '';
        document.getElementById('edit-unit-downpayment').value = unit.downPayment || '';
        document.getElementById('edit-unit-installment-count').value = unit.installmentCount || '';
        document.getElementById('edit-unit-installment-start').value = unit.installmentStartDate || '';
        document.getElementById('edit-unit-paid-installments').value = unit.paidInstallments || '';
        document.getElementById('edit-unit-notes').value = unit.notes || '';
        document.getElementById('edit-unit-title').textContent = `Editar ${unit.label}`;

        // Toggle groups
        const status = unit.status;
        document.getElementById('edit-unit-rent-group').style.display = (status === 'alugado') ? 'block' : 'none';
        document.getElementById('edit-unit-rent-start-group').style.display = (status === 'alugado') ? 'block' : 'none';
        document.getElementById('edit-unit-sale-group').style.display = (status === 'vendido') ? 'block' : 'none';
        document.getElementById('edit-unit-sale-date-group').style.display = (status === 'vendido') ? 'block' : 'none';
        document.getElementById('edit-unit-downpayment-group').style.display = (status === 'vendido') ? 'block' : 'none';
        document.getElementById('edit-unit-installments-group').style.display = (status === 'vendido') ? 'block' : 'none';
        document.getElementById('edit-unit-installment-start-group').style.display = (status === 'vendido') ? 'block' : 'none';
        document.getElementById('edit-unit-paid-group').style.display = (status === 'vendido') ? 'block' : 'none';

        // Show installment preview if data exists
        const preview = document.getElementById('edit-unit-installment-preview');
        if (status === 'vendido' && unit.saleValue && unit.installmentCount) {
            const financed = (unit.saleValue || 0) - (unit.downPayment || 0);
            const installmentVal = financed / unit.installmentCount;
            document.getElementById('edit-unit-installment-value').textContent = formatCurrency(installmentVal);
            document.getElementById('edit-unit-financed-value').textContent = formatCurrency(financed);
            preview.style.display = 'block';
        } else {
            preview.style.display = (status === 'vendido') ? 'block' : 'none';
        }

        document.getElementById('modal-edit-unit').classList.add('visible');
    };

    window.deleteUnit = (buildingId, unitId, e) => {
        if (e) { e.stopPropagation(); e.preventDefault(); }
        const building = real_estate.find(b => b.id === buildingId);
        if (!building) return;
        if (confirm("Deseja excluir esta unidade?")) {
            building.units = building.units.filter(u => u.id !== unitId);
            building.totalUnits = building.units.length;
            saveRealEstate();
            renderBuildingDetail();
            updateRealEstateSummary();
        }
    };

    function getOccupancyInfo(building) {
        const units = building.units || [];
        const activeUnits = units.filter(u => u.status !== 'vendido');
        const total = activeUnits.length;
        const rented = activeUnits.filter(u => u.status === 'alugado').length;
        const sold = units.filter(u => u.status === 'vendido').length;
        const available = activeUnits.filter(u => u.status === 'disponivel').length;
        const occupied = rented;
        const pct = total > 0 ? Math.round((occupied / total) * 100) : 0;
        const todayStr = new Date().toISOString().split('T')[0];
        const totalRent = units.filter(u => u.status === 'alugado').reduce((s, u) => {
            if (u.rentStartDate && u.rentStartDate > todayStr) return s;
            return s + (u.rentValue || 0);
        }, 0);
        const totalSales = units.filter(u => u.status === 'vendido').reduce((s, u) => s + (u.saleValue || 0), 0);

        // Installment receivables calculation
        let totalReceived = 0;
        let totalPending = 0;
        let totalMonthlyInstallments = 0;
        units.filter(u => u.status === 'vendido').forEach(u => {
            const downPay = u.downPayment || 0;
            const count = u.installmentCount || 0;
            const paid = u.paidInstallments || 0;
            const financed = (u.saleValue || 0) - downPay;
            const installmentVal = count > 0 ? financed / count : 0;
            const receivedFromInstallments = paid * installmentVal;
            totalReceived += downPay + receivedFromInstallments;
            totalPending += (count - paid) * installmentVal;
            
            if (count > 0 && paid < count) {
                if (!u.installmentStartDate || u.installmentStartDate <= todayStr) {
                    totalMonthlyInstallments += installmentVal;
                }
            }
        });

        let barClass = 'occupancy-low';
        if (pct >= 90) barClass = 'occupancy-full';
        else if (pct >= 60) barClass = 'occupancy-high';
        else if (pct >= 30) barClass = 'occupancy-medium';

        return { total, rented, sold, available, occupied, pct, barClass, totalRent, totalSales, totalReceived, totalPending, totalMonthlyInstallments };
    }

    function renderBuildingCard(building) {
        const info = getOccupancyInfo(building);

        return `
            <div class="building-card" data-building-id="${building.id}">
                <button class="building-card-delete" data-delete-building="${building.id}" title="Excluir Imóvel">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
                <div class="building-card-header">
                    <div class="building-card-title">
                        <div class="building-card-icon">
                            <i class="fa-solid fa-building"></i>
                        </div>
                        <div>
                            <div class="building-card-name">${building.name}</div>
                            ${building.address ? `<div class="building-card-address"><i class="fa-solid fa-location-dot" style="margin-right:4px;"></i>${building.address}</div>` : ''}
                        </div>
                    </div>
                    <span class="building-card-units-badge">${info.total} unid.</span>
                </div>

                <div class="occupancy-bar-container">
                    <div class="occupancy-bar-label">
                        <span>Ocupação</span>
                        <span class="occupancy-bar-pct">${info.pct}%</span>
                    </div>
                    <div class="occupancy-bar">
                        <div class="occupancy-bar-fill ${info.barClass}" style="width: ${info.pct}%"></div>
                    </div>
                </div>

                <div class="building-card-stats">
                    <div class="building-stat">
                        <span class="building-stat-label">Alugados</span>
                        <span class="building-stat-value green">${info.rented}</span>
                    </div>
                    <div class="building-stat">
                        <span class="building-stat-label">Vendidos</span>
                        <span class="building-stat-value red">${info.sold}</span>
                    </div>
                    <div class="building-stat">
                        <span class="building-stat-label">Disponíveis</span>
                        <span class="building-stat-value gold">${info.available}</span>
                    </div>
                </div>

                <div class="building-card-footer">
                    <div class="building-revenue">
                        <span class="building-revenue-label">Renda Mensal (Alug.+Parc.)</span>
                        <span class="building-revenue-value">${formatCurrency(info.totalRent + info.totalMonthlyInstallments)}</span>
                    </div>
                    ${info.totalSales > 0 ? `
                    <div class="building-revenue">
                        <span class="building-revenue-label">Receita Vendas</span>
                        <span class="building-revenue-value" style="color: var(--accent-red);">${formatCurrency(info.totalSales)}</span>
                    </div>
                    ` : ''}
                    <div class="building-card-arrow">
                        <i class="fa-solid fa-chevron-right"></i>
                    </div>
                </div>
            </div>
        `;
    }

    function renderBuildingDetail() {
        const building = real_estate.find(b => b.id === _currentBuildingId);
        if (!building) return;

        const info = getOccupancyInfo(building);
        document.getElementById('detail-building-name').textContent = building.name;

        // Summary cards
        const summaryEl = document.getElementById('detail-summary-cards');
        summaryEl.innerHTML = `
            <div class="card">
                <div class="card-icon green"><i class="fa-solid fa-key"></i></div>
                <div class="card-info">
                    <h3>Alugados</h3>
                    <h2 style="color: var(--accent-green);">${info.rented} <span style="font-size: 14px; font-weight: 400; color: var(--text-secondary);">de ${info.total}</span></h2>
                </div>
            </div>
            <div class="card">
                <div class="card-icon" style="background-color: rgba(255,61,87,0.1); color: var(--accent-red);"><i class="fa-solid fa-tag"></i></div>
                <div class="card-info">
                    <h3>Vendidos</h3>
                    <h2 style="color: var(--accent-red);">${info.sold} <span style="font-size: 14px; font-weight: 400; color: var(--text-secondary);">${formatCurrency(info.totalSales)}</span></h2>
                </div>
            </div>
            <div class="card">
                <div class="card-icon"><i class="fa-solid fa-coins"></i></div>
                <div class="card-info">
                    <h3>Renda Mensal Ativa</h3>
                    <h2 style="color: var(--accent-green);">${formatCurrency(info.totalRent + info.totalMonthlyInstallments)}</h2>
                </div>
            </div>
            <div class="card">
                <div class="card-icon" style="background-color: rgba(255,165,0,0.1); color: #FFA000;"><i class="fa-solid fa-file-invoice-dollar"></i></div>
                <div class="card-info">
                    <h3>A Receber (Parcelas)</h3>
                    <h2 style="color: #FFA000;">${formatCurrency(info.totalPending)} <span style="font-size: 14px; font-weight: 400; color: var(--text-secondary);">de ${formatCurrency(info.totalSales)}</span></h2>
                </div>
            </div>
        `;

        // Units grid
        let units = building.units || [];
        if (_currentUnitFilter !== 'all') {
            units = units.filter(u => u.status === _currentUnitFilter);
        }

        const unitsGrid = document.getElementById('units-grid');
        if (units.length === 0) {
            unitsGrid.innerHTML = '<div class="empty-state" style="grid-column: 1/-1; padding: 40px;">Nenhuma unidade encontrada para este filtro.</div>';
            return;
        }

        unitsGrid.innerHTML = units.map(u => {
            const statusLabel = u.status === 'alugado' ? 'Alugado' : u.status === 'vendido' ? 'Vendido' : 'Disponível';
            let valueHtml = '';
            if (u.status === 'alugado' && u.rentValue) {
                valueHtml = `<div class="unit-card-value rent">${formatCurrency(u.rentValue)}/mês</div>`;
            } else if (u.status === 'vendido' && u.saleValue) {
                const downPay = u.downPayment || 0;
                const count = u.installmentCount || 0;
                const paid = u.paidInstallments || 0;
                const financed = u.saleValue - downPay;
                const installmentVal = count > 0 ? financed / count : 0;
                const pctPaid = count > 0 ? Math.round((paid / count) * 100) : 0;
                const totalRecv = downPay + (paid * installmentVal);

                if (count > 0) {
                    valueHtml = `
                        <div class="unit-card-value sale">${formatCurrency(u.saleValue)}</div>
                        <div class="unit-installment-info">
                            <div class="unit-installment-header">
                                <span class="unit-installment-label">Entrada: ${formatCurrency(downPay)}</span>
                                <span class="unit-installment-count">${paid}/${count} parcelas</span>
                            </div>
                            <div class="unit-installment-bar">
                                <div class="unit-installment-bar-fill" style="width: ${pctPaid}%"></div>
                            </div>
                            <div class="unit-installment-footer">
                                <span class="unit-installment-received"><i class="fa-solid fa-check-circle" style="margin-right:3px;"></i>Recebido: ${formatCurrency(totalRecv)}</span>
                                <span class="unit-installment-pending">Restante: ${formatCurrency(financed - (paid * installmentVal))}</span>
                            </div>
                        </div>
                    `;
                } else {
                    valueHtml = `<div class="unit-card-value sale">${formatCurrency(u.saleValue)}</div>`;
                }
            } else {
                valueHtml = `<div class="unit-card-value empty">—</div>`;
            }

            return `
                <div class="unit-card status-${u.status}" data-edit-unit="${u.id}" data-parent-building="${building.id}">
                    <button class="unit-card-delete-btn" data-delete-unit="${u.id}" data-delete-unit-building="${building.id}" title="Excluir Unidade">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                    <div class="unit-card-header">
                        <span class="unit-card-label">${u.label}</span>
                        <span class="unit-status-badge ${u.status}">${statusLabel}</span>
                    </div>
                    ${valueHtml}
                    ${u.notes ? `<div class="unit-card-notes"><i class="fa-solid fa-comment" style="margin-right:4px; opacity: 0.5;"></i>${u.notes}</div>` : ''}
                </div>
            `;
        }).join('');
    }

    function updateRealEstateSummary() {
        let totalUnits = 0, totalRent = 0, totalSales = 0, totalMonthlyInstallments = 0;
        real_estate.forEach(b => {
            const info = getOccupancyInfo(b);
            totalUnits += info.total;
            totalRent += info.totalRent;
            totalSales += info.totalSales;
            totalMonthlyInstallments += info.totalMonthlyInstallments;
        });

        const unitsEl = document.getElementById('re-total-units');
        const rentEl = document.getElementById('re-total-rent');
        const salesEl = document.getElementById('re-total-sales');

        if (unitsEl) unitsEl.textContent = totalUnits;
        if (rentEl) rentEl.textContent = formatCurrency(totalRent + totalMonthlyInstallments);
        if (salesEl) salesEl.textContent = formatCurrency(totalSales);

        // Update Visão Geral revenue card (reuse existing RE summary element)
        const revEl = document.getElementById('re-monthly-revenue');
        if (revEl) revEl.innerText = formatCurrency(totalRent + totalMonthlyInstallments);
    }

    // ─── Rental Income Chart & Timeframe Filter ──────────────────────────────
    window._chartTimeframe = '12m';

    window.setChartTimeframe = (tf, btn) => {
        window._chartTimeframe = tf;
        const buttons = btn.parentElement.querySelectorAll('.btn-filter');
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderRentalIncomeChart();
        renderSalesGrowthChart();
    };

    function calcMonthRevs(d) {
        let mRent = 0;
        let mInst = 0;
        let mSaleVolume = 0;
        const defaultStartDate = new Date(2026, 3, 1); // April 2026

        real_estate.forEach(b => {
            (b.units || []).forEach(u => {
                if (u.status === 'alugado' && u.rentValue > 0) {
                    if (!u.rentStartDate) {
                        // If no start date was set, default to April 2026 (when the system was started)
                        if (d >= defaultStartDate) mRent += u.rentValue;
                    } else {
                        const start = new Date(u.rentStartDate + 'T12:00:00Z');
                        const startMonth = new Date(start.getFullYear(), start.getMonth(), 1);
                        if (d >= startMonth) mRent += u.rentValue;
                    }
                }
                if (u.status === 'vendido' && u.saleValue > 0) {
                    if (u.installmentCount > 0 && u.installmentStartDate) {
                        const downPay = u.downPayment || 0;
                        const financed = u.saleValue - downPay;
                        const installmentVal = financed / u.installmentCount;
                        const start = new Date(u.installmentStartDate + 'T12:00:00Z');
                        const startMonth = new Date(start.getFullYear(), start.getMonth(), 1);
                        const endMonth = new Date(start.getFullYear(), start.getMonth() + u.installmentCount, 1);
                        if (d >= startMonth && d < endMonth) mInst += installmentVal;
                    }
                    if (u.saleDate) {
                        const saleD = new Date(u.saleDate + 'T12:00:00Z');
                        if (saleD.getFullYear() === d.getFullYear() && saleD.getMonth() === d.getMonth()) {
                            mSaleVolume += u.saleValue;
                        }
                    }
                }
            });
        });
        return { mRent, mInst, mSaleVolume };
    }

    let rentalChartObj = null;

    function renderRentalIncomeChart() {
        const ctx = document.getElementById('rentalIncomeChart');
        if (!ctx) return;

        // Configuration
        const today = new Date();
        const labels = [];
        const rentData = [];
        const installmentsData = [];

        let kpiThisMonth = 0;
        let kpiLastMonth = 0;
        let kpiYTD_Rent = 0;
        let kpiYTD_Inst = 0;

        // KPI calculation is always monthly
        for (let i = 11; i >= 0; i--) {
            const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
            const revs = calcMonthRevs(d);
            const totalMonth = revs.mRent + revs.mInst;
            
            if (i === 0) kpiThisMonth = totalMonth;
            if (i === 1) kpiLastMonth = totalMonth;
            if (d.getFullYear() === today.getFullYear()) {
                kpiYTD_Rent += revs.mRent;
                kpiYTD_Inst += revs.mSaleVolume; // Sum full sale volume instead of just installments for YTD
            }
        }

        if (window._chartTimeframe === '12m') {
            const MONTHS_BACK = 11;
            for (let i = MONTHS_BACK; i >= 0; i--) {
                const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
                
                const april2026 = new Date(2026, 3, 1);
                if (d >= april2026) {
                    const monthStr = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`;
                    labels.push(monthStr);
                    const revs = calcMonthRevs(d);
                    rentData.push(revs.mRent);
                    installmentsData.push(revs.mInst);
                }
            }
        } else {
            // '12y' timeframe
            let minYear = today.getFullYear() - 11; 
            
            real_estate.forEach(b => {
                (b.units || []).forEach(u => {
                    if (u.rentStartDate) {
                        const y = new Date(u.rentStartDate + 'T12:00:00Z').getFullYear();
                        if (y < minYear && y >= today.getFullYear() - 11) minYear = y;
                    }
                });
            });

            for (let y = minYear; y <= today.getFullYear(); y++) {
                labels.push(y.toString());
                let yearRent = 0;
                let yearInst = 0;
                for (let m = 0; m < 12; m++) {
                    const d = new Date(y, m, 1);
                    if (d > today) break;
                    const revs = calcMonthRevs(d);
                    yearRent += revs.mRent;
                    yearInst += revs.mInst;
                }
                rentData.push(yearRent);
                installmentsData.push(yearInst);
            }
        }

        // Update KPIs
        const elThis = document.getElementById('kpi-this-month');
        const elLast = document.getElementById('kpi-last-month');
        const elMom = document.getElementById('kpi-mom-change');
        const elYtd = document.getElementById('kpi-ytd');

        if (elThis) elThis.textContent = formatCurrency(kpiThisMonth);
        if (elLast) elLast.textContent = formatCurrency(kpiLastMonth);
        
        if (elYtd) {
            const totalYtd = kpiYTD_Rent + kpiYTD_Inst;
            elYtd.innerHTML = `<div style="font-size: 11px; font-weight: normal; color: var(--text-secondary); margin-bottom: 2px;">
                Aluguel (${formatCurrency(kpiYTD_Rent)}) + Venda (${formatCurrency(kpiYTD_Inst)})
            </div>
            <div>${formatCurrency(totalYtd)}</div>`;
        }

        if (elMom) {
            if (kpiLastMonth > 0) {
                const diff = ((kpiThisMonth - kpiLastMonth) / kpiLastMonth) * 100;
                const sign = diff > 0 ? '+' : '';
                const color = diff > 0 ? 'var(--accent-green)' : (diff < 0 ? 'var(--accent-red)' : 'var(--text-secondary)');
                elMom.textContent = `${sign}${diff.toFixed(1)}%`;
                elMom.style.color = color;
            } else {
                elMom.textContent = '-';
                elMom.style.color = 'var(--text-secondary)';
            }
        }

        if (rentalChartObj) {
            rentalChartObj.destroy();
            rentalChartObj = null;
        }

        const chartConfig = {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Aluguéis',
                        data: rentData,
                        backgroundColor: 'rgba(0, 200, 83, 0.7)',
                        borderColor: '#00C853',
                        borderWidth: 1,
                        borderRadius: 4
                    },
                    {
                        label: 'Parcelas (Vendas)',
                        data: installmentsData,
                        backgroundColor: 'rgba(255, 160, 0, 0.7)',
                        borderColor: '#FFA000',
                        borderWidth: 1,
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        stacked: true,
                        grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false },
                        ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 11 } }
                    },
                    y: {
                        stacked: true,
                        beginAtZero: true,
                        grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false },
                        ticks: {
                            color: 'rgba(255,255,255,0.5)',
                            callback: function(value) { return 'R$ ' + (value/1000) + 'k'; },
                            font: { size: 11 }
                        }
                    }
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: 'rgba(255,255,255,0.7)', usePointStyle: true, pointStyleWidth: 10 }
                    },
                    tooltip: {
                        mode: 'index',
                        backgroundColor: 'rgba(0,0,0,0.8)',
                        titleColor: 'rgba(255,255,255,0.9)',
                        bodyColor: 'rgba(255,255,255,0.8)',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1,
                        padding: 12,
                        callbacks: {
                            label: function(context) {
                                return context.dataset.label + ': ' + formatCurrency(context.raw);
                            }
                        }
                    }
                }
            }
        };

        const theme = document.documentElement.getAttribute('data-theme') || 'dark';
        if (theme === 'light') {
            chartConfig.options.scales.x.grid.color = 'rgba(0,0,0,0.05)';
            chartConfig.options.scales.x.ticks.color = 'rgba(0,0,0,0.5)';
            chartConfig.options.scales.y.grid.color = 'rgba(0,0,0,0.05)';
            chartConfig.options.scales.y.ticks.color = 'rgba(0,0,0,0.5)';
            chartConfig.options.plugins.legend.labels.color = 'rgba(0,0,0,0.7)';
            chartConfig.options.plugins.tooltip.backgroundColor = 'rgba(255,255,255,0.9)';
            chartConfig.options.plugins.tooltip.titleColor = 'rgba(0,0,0,0.8)';
            chartConfig.options.plugins.tooltip.bodyColor = 'rgba(0,0,0,0.7)';
        }

        if (rentalChartObj) {
            rentalChartObj.data = chartConfig.data;
            rentalChartObj.options = chartConfig.options;
            rentalChartObj.update();
        } else {
            rentalChartObj = new Chart(ctx.getContext('2d'), chartConfig);
        }
    }

    let salesChartObj = null;

    function renderSalesGrowthChart() {
        const ctx = document.getElementById('salesGrowthChart');
        if (!ctx) return;

        const today = new Date();
        const labels = [];
        const salesData = [];
        const accumData = [];
        
        let accumulatedSales = 0;

        if (window._chartTimeframe === '12m') {
            let minDate = new Date(today.getFullYear(), today.getMonth() - 11, 1);

            real_estate.forEach(b => {
                (b.units || []).forEach(u => {
                    if (u.status === 'vendido' && u.saleValue > 0 && u.saleDate) {
                        const saleD = new Date(u.saleDate + 'T12:00:00Z');
                        const saleMonth = new Date(saleD.getFullYear(), saleD.getMonth(), 1);
                        if (saleMonth < minDate) {
                            minDate = saleMonth;
                        }
                    }
                });
            });

            const rawMonthsBack = (today.getFullYear() - minDate.getFullYear()) * 12 + (today.getMonth() - minDate.getMonth());
            const MONTHS_BACK = Math.max(0, Math.min(rawMonthsBack, 120));

            const startDate = new Date(today.getFullYear(), today.getMonth() - MONTHS_BACK, 1);
            
            real_estate.forEach(b => {
                (b.units || []).forEach(u => {
                    if (u.status === 'vendido' && u.saleValue > 0 && u.saleDate) {
                        const saleD = new Date(u.saleDate + 'T12:00:00Z');
                        if (saleD < startDate) {
                            accumulatedSales += u.saleValue;
                        }
                    }
                });
            });

            for (let i = MONTHS_BACK; i >= 0; i--) {
                const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
                const monthStr = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`;
                labels.push(monthStr);

                let monthSales = 0;
                real_estate.forEach(b => {
                    (b.units || []).forEach(u => {
                        if (u.status === 'vendido' && u.saleValue > 0 && u.saleDate) {
                            const saleD = new Date(u.saleDate + 'T12:00:00Z');
                            if (saleD.getFullYear() === d.getFullYear() && saleD.getMonth() === d.getMonth()) {
                                monthSales += u.saleValue;
                            }
                        }
                    });
                });

                salesData.push(monthSales);
                accumulatedSales += monthSales;
                accumData.push(accumulatedSales);
            }
        } else {
            // '12y' timeframe
            let minYear = today.getFullYear() - 11;
            
            real_estate.forEach(b => {
                (b.units || []).forEach(u => {
                    if (u.status === 'vendido' && u.saleValue > 0 && u.saleDate) {
                        const saleY = new Date(u.saleDate + 'T12:00:00Z').getFullYear();
                        if (saleY < minYear) minYear = saleY;
                    }
                });
            });
            
            if (minYear < today.getFullYear() - 11) {
                minYear = today.getFullYear() - 11;
            }

            real_estate.forEach(b => {
                (b.units || []).forEach(u => {
                    if (u.status === 'vendido' && u.saleValue > 0 && u.saleDate) {
                        const saleY = new Date(u.saleDate + 'T12:00:00Z').getFullYear();
                        if (saleY < minYear) {
                            accumulatedSales += u.saleValue;
                        }
                    }
                });
            });

            for (let y = minYear; y <= today.getFullYear(); y++) {
                labels.push(y.toString());
                
                let yearSales = 0;
                real_estate.forEach(b => {
                    (b.units || []).forEach(u => {
                        if (u.status === 'vendido' && u.saleValue > 0 && u.saleDate) {
                            const saleY = new Date(u.saleDate + 'T12:00:00Z').getFullYear();
                            if (saleY === y) {
                                yearSales += u.saleValue;
                            }
                        }
                    });
                });

                salesData.push(yearSales);
                accumulatedSales += yearSales;
                accumData.push(accumulatedSales);
            }
        }

        if (salesChartObj) {
            salesChartObj.destroy();
            salesChartObj = null;
        }

        const chartConfig = {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Vendas no Mês',
                        data: salesData,
                        backgroundColor: 'rgba(41, 98, 255, 0.7)',
                        borderColor: '#2962FF',
                        borderWidth: 1,
                        borderRadius: 4,
                        order: 2
                    },
                    {
                        label: 'Acumulado Total',
                        data: accumData,
                        type: 'line',
                        borderColor: '#00C853',
                        backgroundColor: 'rgba(0, 200, 83, 0.08)',
                        borderWidth: 2,
                        pointRadius: 3,
                        pointHoverRadius: 6,
                        tension: 0.3,
                        fill: true,
                        order: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: 'rgba(255,255,255,0.7)', usePointStyle: true, pointStyleWidth: 10 }
                    },
                    tooltip: {
                        mode: 'index',
                        backgroundColor: 'rgba(0,0,0,0.8)',
                        titleColor: 'rgba(255,255,255,0.9)',
                        bodyColor: 'rgba(255,255,255,0.8)',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1,
                        padding: 12,
                        callbacks: {
                            label: function(context) {
                                return context.dataset.label + ': ' + formatCurrency(context.raw);
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false },
                        ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 11 } }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false },
                        ticks: {
                            color: 'rgba(255,255,255,0.5)',
                            callback: function(value) { return 'R$ ' + (value/1000) + 'k'; },
                            font: { size: 11 }
                        }
                    }
                }
            }
        };

        const theme = document.documentElement.getAttribute('data-theme') || 'dark';
        if (theme === 'light') {
            chartConfig.options.scales.x.grid.color = 'rgba(0,0,0,0.05)';
            chartConfig.options.scales.x.ticks.color = 'rgba(0,0,0,0.5)';
            chartConfig.options.scales.y.grid.color = 'rgba(0,0,0,0.05)';
            chartConfig.options.scales.y.ticks.color = 'rgba(0,0,0,0.5)';
            chartConfig.options.plugins.legend.labels.color = 'rgba(0,0,0,0.7)';
            chartConfig.options.plugins.tooltip.backgroundColor = 'rgba(255,255,255,0.9)';
            chartConfig.options.plugins.tooltip.titleColor = 'rgba(0,0,0,0.8)';
            chartConfig.options.plugins.tooltip.bodyColor = 'rgba(0,0,0,0.7)';
        }

        salesChartObj = new Chart(ctx.getContext('2d'), chartConfig);
    }

    window.updateRealEstateUI = () => {
        const grid = document.getElementById('re-buildings-grid');
        if (!grid) return;

        if (real_estate.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1; padding: 60px 20px;">
                    <i class="fa-solid fa-city" style="font-size: 48px; color: var(--text-secondary); opacity: 0.3; margin-bottom: 16px; display: block;"></i>
                    Nenhum imóvel cadastrado. Clique em "Novo Imóvel" para começar.
                </div>
            `;
        } else {
            grid.innerHTML = real_estate.map(b => renderBuildingCard(b)).join('');
        }

        updateRealEstateSummary();
        renderRentalIncomeChart();
        renderSalesGrowthChart();

        // If detail panel is open, refresh it too
        if (_currentBuildingId) {
            const building = real_estate.find(b => b.id === _currentBuildingId);
            if (building) {
                renderBuildingDetail();
            }
        }
    };

    // ─── Event Delegation (avoids inline onclick bubbling issues) ─────────────
    const buildingsGrid = document.getElementById('re-buildings-grid');
    if (buildingsGrid) {
        buildingsGrid.addEventListener('click', (e) => {
            // Check if clicked on delete button or its child icon
            const deleteBtn = e.target.closest('[data-delete-building]');
            if (deleteBtn) {
                e.stopPropagation();
                const id = parseInt(deleteBtn.getAttribute('data-delete-building'));
                window.deleteBuilding(id);
                return;
            }
            // Otherwise, check if clicked on a building card
            const card = e.target.closest('[data-building-id]');
            if (card) {
                const id = parseInt(card.getAttribute('data-building-id'));
                window.openBuildingDetail(id);
            }
        });
    }

    const unitsGridEl = document.getElementById('units-grid');
    if (unitsGridEl) {
        unitsGridEl.addEventListener('click', (e) => {
            // Check if clicked on delete button or its child icon
            const deleteBtn = e.target.closest('[data-delete-unit]');
            if (deleteBtn) {
                e.stopPropagation();
                const unitId = parseInt(deleteBtn.getAttribute('data-delete-unit'));
                const buildingId = parseInt(deleteBtn.getAttribute('data-delete-unit-building'));
                window.deleteUnit(buildingId, unitId);
                return;
            }
            // Otherwise, check if clicked on a unit card
            const card = e.target.closest('[data-edit-unit]');
            if (card) {
                const unitId = parseInt(card.getAttribute('data-edit-unit'));
                const buildingId = parseInt(card.getAttribute('data-parent-building'));
                window.editUnit(buildingId, unitId);
            }
        });
    }

    const formAddBuilding = document.getElementById('form-add-building');
    if (formAddBuilding) {
        formAddBuilding.addEventListener('submit', (e) => {
            e.preventDefault();
            const name = document.getElementById('building-name').value.trim();
            const qty = parseInt(document.getElementById('building-units-qty').value) || 0;
            const prefix = document.getElementById('building-unit-prefix').value.trim() || 'Unidade';
            const address = document.getElementById('building-address').value.trim();

            if (!name || qty <= 0) return;

            const units = [];
            for (let i = 1; i <= qty; i++) {
                units.push({
                    id: i,
                    label: `${prefix} ${i}`,
                    status: 'disponivel',
                    rentValue: 0,
                    saleValue: 0,
                    notes: ''
                });
            }

            real_estate.push({
                id: Date.now(),
                name,
                address,
                totalUnits: qty,
                units
            });

            saveRealEstate();
            updateRealEstateUI();

            document.getElementById('modal-add-building').classList.remove('visible');
            formAddBuilding.reset();
        });
    }

    // ─── Form: Edit Building ─────────────────────────────────────────────────
    const formEditBuilding = document.getElementById('form-edit-building');
    if (formEditBuilding) {
        formEditBuilding.addEventListener('submit', (e) => {
            e.preventDefault();
            const buildingId = parseInt(document.getElementById('edit-building-id').value);
            const building = real_estate.find(b => b.id === buildingId);
            if (!building) return;

            building.name = document.getElementById('edit-building-name').value.trim();
            building.address = document.getElementById('edit-building-address').value.trim();

            saveRealEstate();
            
            // Update detail panel header
            document.getElementById('detail-building-name').textContent = building.name;
            
            document.getElementById('modal-edit-building').classList.remove('visible');
        });
    }

    // ─── Form: Edit Unit ─────────────────────────────────────────────────────
    const formEditUnit = document.getElementById('form-edit-unit');
    if (formEditUnit) {
        formEditUnit.addEventListener('submit', (e) => {
            e.preventDefault();
            const buildingId = parseInt(document.getElementById('edit-unit-building-id').value);
            const unitId = parseInt(document.getElementById('edit-unit-id').value);

            const building = real_estate.find(b => b.id === buildingId);
            if (!building) return;
            const unit = building.units.find(u => u.id === unitId);
            if (!unit) return;

            unit.label = document.getElementById('edit-unit-label').value.trim();
            unit.status = document.getElementById('edit-unit-status').value;
            unit.rentValue = parseFloat(document.getElementById('edit-unit-rent').value) || 0;
            unit.rentStartDate = document.getElementById('edit-unit-rent-start').value || '';
            unit.saleValue = parseFloat(document.getElementById('edit-unit-sale').value) || 0;
            unit.saleDate = document.getElementById('edit-unit-sale-date').value || '';
            unit.downPayment = parseFloat(document.getElementById('edit-unit-downpayment').value) || 0;
            unit.installmentCount = parseInt(document.getElementById('edit-unit-installment-count').value) || 0;
            unit.installmentStartDate = document.getElementById('edit-unit-installment-start').value || '';
            unit.paidInstallments = parseInt(document.getElementById('edit-unit-paid-installments').value) || 0;
            unit.notes = document.getElementById('edit-unit-notes').value.trim();

            saveRealEstate();
            renderBuildingDetail();
            updateRealEstateSummary();
            renderRentalIncomeChart();

            document.getElementById('modal-edit-unit').classList.remove('visible');
        });
    }

    // ─── Form: Add Unit ──────────────────────────────────────────────────────
    const formAddUnit = document.getElementById('form-add-unit');
    if (formAddUnit) {
        formAddUnit.addEventListener('submit', (e) => {
            e.preventDefault();
            const building = real_estate.find(b => b.id === _currentBuildingId);
            if (!building) return;

            const label = document.getElementById('add-unit-label').value.trim();
            const status = document.getElementById('add-unit-status').value;
            if (!label) return;

            const maxId = building.units.reduce((max, u) => Math.max(max, u.id), 0);
            building.units.push({
                id: maxId + 1,
                label,
                status,
                rentValue: 0,
                saleValue: 0,
                notes: ''
            });
            building.totalUnits = building.units.length;

            saveRealEstate();
            renderBuildingDetail();
            updateRealEstateSummary();

            document.getElementById('modal-add-unit').classList.remove('visible');
            formAddUnit.reset();
        });
    }

    // ─── Carregar dados do servidor ──────────────────────────────────────────
    const online = await checkAPIHealth();
    if (online) {
        const loaded = await loadAssetsFromServer();
        if (!loaded) console.warn('Sem ativos no servidor, usando lista vazia.');
        
        const loadedRe = await loadRealEstateFromServer();
        if (!loadedRe) console.warn('Sem imóveis no servidor, usando lista vazia.');
    }

    // ─── Initial Render ──────────────────────────────────────────────────
    updateAssetListUI();
    updateMeusAtivosUI();
    updateDetailedPortfolioUI();
    updateTotalEquity();
    updateRealEstateUI();

    // ─── Auto-refresh cotações ────────────────────────────────────────────
    if (online) {
        await refreshAllQuotes();
    }
    
    // Re-check API a cada 30 segundos
    setInterval(checkAPIHealth, 30000);

    // ─── Polling para sincronizar entre dispositivos ─────────────────────
    setInterval(pollForUpdates, 5000);  // Dados: checa a cada 5 segundos

    // ─── Live Reload: detecta mudanças no código ─────────────────────────
    setInterval(pollForCodeChanges, 3000);  // Código: checa a cada 3 segundos

});
