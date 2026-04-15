// ═══════════════════════════════════════════════════════════════════════════
//  Family Office — Dashboard com Cotações em Tempo Real
//  Motor: yfinance via Flask API local (porta 5000)
// ═══════════════════════════════════════════════════════════════════════════

const API_BASE = '/api';

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

    const growthChart = new Chart(ctx, {
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
        
        growthChart.data.labels = labels.slice(sIdx, eIdx + 1);
        growthChart.data.datasets[0].data = portfolioData.slice(sIdx, eIdx + 1);
        growthChart.data.datasets[1].data = cdiData.slice(sIdx, eIdx + 1);
        growthChart.data.principalSliced = principalData.slice(sIdx, eIdx + 1);
        growthChart.update();
        if (typeof validateActiveButton === 'function') validateActiveButton();
    };

    startDateInput.addEventListener('change', filterChartData);
    endDateInput.addEventListener('change', filterChartData);
    
    // Quick filters
    const quickFilters = document.querySelectorAll('#quick-filters .btn-filter');
    
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
        // Capital do Financial que veio do RE (para evitar soma dupla)
        const totalAlocadoDeRE = assets.reduce((sum, a) => sum + (a.reInvested || 0), 0);
        const totalReRecebido = real_estate.reduce((sum, re) => sum + (re.downpayment || 0), 0);
        
        // Patrimônio Total: Dinheiro nos ativos + Dinheiro recebido de RE que AINDA NÃO FOI ALOCADO
        const total = totalFinanceiro + (totalReRecebido - totalAlocadoDeRE);
        document.getElementById('total-equity').innerHTML = formatCurrency(total);
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

    // ─── Real Estate Cashflow Logic ───────────────────────────────────────────
    let cashflowChartObj = null;

    window.deleteRealEstate = (id) => {
        if(confirm("Deseja realmente excluir este contrato imobiliário?")) {
            real_estate = real_estate.filter(r => r.id != id);
            saveRealEstate();
            if (typeof updateRealEstateUI === 'function') updateRealEstateUI();
        }
    };

    window.markInstallmentPaid = (reId, instIndex) => {
        const re = real_estate.find(r => r.id == reId);
        if (re && re.installments[instIndex]) {
            re.installments[instIndex].paid = !re.installments[instIndex].paid;
            if (re.installments[instIndex].paid) {
                re.downpayment += re.installments[instIndex].value;
            } else {
                re.downpayment -= re.installments[instIndex].value;
            }
            saveRealEstate();
            updateRealEstateUI();
        }
    };

    window.addPayment = (id) => {
        let re = real_estate.find(r => r.id === id);
        if(!re) return;
        let p = prompt(`Qual o valor recebido para '${re.name}'?`);
        if(p) {
            let val = parseFloat(p.replace(',', '.'));
            if(!isNaN(val) && val > 0) {
                re.downpayment += val;
                
                // Amortiza das parcelas abertas mais antigas
                if(re.installments) {
                    let toDeduct = val;
                    re.installments.sort((a,b) => new Date(a.date) - new Date(b.date));
                    for(let inst of re.installments) {
                        if(!inst.paid && toDeduct > 0) {
                            if(inst.value <= toDeduct) {
                                toDeduct -= inst.value;
                                inst.paid = true;
                            } else {
                                inst.value -= toDeduct;
                                toDeduct = 0;
                            }
                        }
                    }
                }
                saveRealEstate();
                if (typeof updateRealEstateUI === 'function') updateRealEstateUI();
            }
        }
    };

    window.updateRealEstateUI = () => {
        let tbody = '';
        let totalRevenue30d = 0;
        
        // Setup dates for projection (next 12 months)
        const today = new Date();
        const next30Days = new Date(today.getTime() + (30 * 24 * 60 * 60 * 1000));
        
        const projectionMap = {};
        for(let i=0; i<12; i++) {
            let d = new Date(today.getFullYear(), today.getMonth() + i, 1);
            let key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
            projectionMap[key] = { label: `${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`, total: 0 };
        }

        real_estate.forEach(re => {
            let received = re.downpayment || 0;
            let total = re.value || 0;
            let remaining = total - received;
            
            // Calculate projections
            if(re.installments) {
                re.installments.forEach(inst => {
                    if(!inst.paid) {
                        // Tratar timezone para a data (evitar pular mês por fuso)
                        const d = new Date(inst.date + 'T12:00:00Z');
                        
                        if(d >= today && d <= next30Days) {
                            totalRevenue30d += inst.value;
                        }
                        
                        // Chart Projection
                        let pKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
                        if(projectionMap[pKey]) {
                            projectionMap[pKey].total += inst.value;
                        }
                    }
                });
            }

            tbody += `
                <tr>
                    <td class="asset-name" style="color: #fff; font-weight: 600;">${re.name}</td>
                    <td>${formatCurrency(total)}</td>
                    <td style="color: var(--accent-green); font-weight: 500;">${formatCurrency(received)}</td>
                    <td style="color: var(--accent-gold); font-weight: 600;">${formatCurrency(remaining)}</td>
                    <td style="text-align: right;">
                        <button onclick="window.addPayment(${re.id})" title="Lançar Pagamento Recebido" style="background:var(--accent-green); border:none; color:#131722; cursor:pointer; font-size:11px; font-weight:600; padding:4px 8px; border-radius:4px; margin-right:8px;"><i class="fa-solid fa-plus"></i></button>
                        <button class="btn-del" onclick="window.deleteRealEstate(${re.id})" title="Excluir" style="background:none; border:none; color:#FF3D57; cursor:pointer;" class="btn-filter"><i class="fa-solid fa-trash"></i></button>
                    </td>
                </tr>
            `;
        });

        const listEl = document.getElementById('kb-prospeccao'); // Reusing ID from table body
        if (listEl) {
            listEl.innerHTML = real_estate.length > 0 ? tbody : '<tr><td colspan="5" class="empty-state">Nenhum contrato ativo.</td></tr>';
        }

        // Update Dashboard Summary Widget
        const revEl = document.getElementById('re-monthly-revenue');
        if (revEl) revEl.innerText = formatCurrency(totalRevenue30d);
        
        // Update Chart
        const chartLabels = Object.values(projectionMap).map(v => v.label);
        const chartData = Object.values(projectionMap).map(v => v.total);
        
        const ctx = document.getElementById('cashflowChart');
        if (ctx) {
            if (cashflowChartObj) {
                cashflowChartObj.data.labels = chartLabels;
                cashflowChartObj.data.datasets[0].data = chartData;
                cashflowChartObj.update();
            } else {
                cashflowChartObj = new Chart(ctx.getContext('2d'), {
                    type: 'bar',
                    data: {
                        labels: chartLabels,
                        datasets: [{
                            label: 'Recebimentos Futuros',
                            data: chartData,
                            backgroundColor: 'rgba(41, 98, 255, 0.7)',
                            borderColor: '#2962FF',
                            borderWidth: 1,
                            borderRadius: 4
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: false },
                            tooltip: { 
                                callbacks: { 
                                    label: (c) => formatCurrency(c.raw) 
                                } 
                            }
                        },
                        scales: {
                            y: { ticks: { callback: (val) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumSignificantDigits: 3, notation:'compact' }).format(val) }, grid: { color: 'rgba(255,255,255,0.05)' } },
                            x: { grid: { display: false } }
                        }
                    }
                });
            }
        }
        
        if (typeof window.updateTotalEquity === 'function') {
            window.updateTotalEquity();
        }
    };

    const reForm = document.getElementById('re-form');
    if (reForm) {
        reForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const name = document.getElementById('re-name').value;
            const value = parseFloat(document.getElementById('re-value').value) || 0;
            const downpayment = parseFloat(document.getElementById('re-downpayment').value) || 0;
            
            // Mensais
            const mensaisQtd = parseInt(document.getElementById('re-mensais-qtd').value) || 0;
            const mensaisVal = parseFloat(document.getElementById('re-mensais-val').value) || 0;
            const mensaisInicioStr = document.getElementById('re-mensais-inicio').value;
            
            // Balões
            const balaoQtd = parseInt(document.getElementById('re-balao-qtd').value) || 0;
            const balaoVal = parseFloat(document.getElementById('re-balao-val').value) || 0;
            const balaoInicioStr = document.getElementById('re-balao-inicio').value;
            const balaoFreq = parseInt(document.getElementById('re-balao-freq').value) || 12;

            const installments = [];
            
            // Generate Monthly
            if (mensaisQtd > 0 && mensaisVal > 0 && mensaisInicioStr) {
                // T + 12:00:00Z previne fuso de roubar 1 dia no Javascript local
                const mensaisInicio = new Date(mensaisInicioStr + 'T12:00:00Z');
                for (let i=0; i<mensaisQtd; i++) {
                    let d = new Date(mensaisInicio.getTime());
                    d.setMonth(d.getMonth() + i);
                    installments.push({
                        type: 'Mensal',
                        value: mensaisVal,
                        date: d.toISOString().split('T')[0],
                        paid: false
                    });
                }
            }
            
            // Generate Baloes
            if (balaoQtd > 0 && balaoVal > 0 && balaoInicioStr) {
                const balaoInicio = new Date(balaoInicioStr + 'T12:00:00Z');
                for (let i=0; i<balaoQtd; i++) {
                    let d = new Date(balaoInicio.getTime());
                    d.setMonth(d.getMonth() + (i * balaoFreq));
                    installments.push({
                        type: 'Balão',
                        value: balaoVal,
                        date: d.toISOString().split('T')[0],
                        paid: false
                    });
                }
            }

            real_estate.push({
                id: Date.now(),
                name,
                value,
                downpayment,
                installments
            });

            saveRealEstate();
            updateRealEstateUI();
            
            document.getElementById('modal-real-estate').classList.remove('visible');
            reForm.reset();
        });
    }

    const vgReForm = document.getElementById('add-imob-form');
    if (vgReForm) {
        vgReForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const name = document.getElementById('vg-re-name').value;
            const value = parseFloat(document.getElementById('vg-re-value').value) || 0;
            const downpayment = parseFloat(document.getElementById('vg-re-downpayment').value) || 0;
            
            const mensaisQtd = parseInt(document.getElementById('vg-re-mensais-qtd').value) || 0;
            const mensaisVal = parseFloat(document.getElementById('vg-re-mensais-val').value) || 0;
            const mensaisInicioStr = document.getElementById('vg-re-mensais-inicio').value;
            
            const balaoQtd = parseInt(document.getElementById('vg-re-balao-qtd').value) || 0;
            const balaoVal = parseFloat(document.getElementById('vg-re-balao-val').value) || 0;
            const balaoInicioStr = document.getElementById('vg-re-balao-inicio').value;
            const balaoFreq = parseInt(document.getElementById('vg-re-balao-freq').value) || 12;

            const installments = [];
            
            if (mensaisQtd > 0 && mensaisVal > 0 && mensaisInicioStr) {
                const mensaisInicio = new Date(mensaisInicioStr + 'T12:00:00Z');
                for (let i=0; i<mensaisQtd; i++) {
                    let d = new Date(mensaisInicio.getTime());
                    d.setMonth(d.getMonth() + i);
                    installments.push({ type: 'Mensal', value: mensaisVal, date: d.toISOString().split('T')[0], paid: false });
                }
            }
            
            if (balaoQtd > 0 && balaoVal > 0 && balaoInicioStr) {
                const balaoInicio = new Date(balaoInicioStr + 'T12:00:00Z');
                for (let i=0; i<balaoQtd; i++) {
                    let d = new Date(balaoInicio.getTime());
                    d.setMonth(d.getMonth() + (i * balaoFreq));
                    installments.push({ type: 'Balão', value: balaoVal, date: d.toISOString().split('T')[0], paid: false });
                }
            }

            real_estate.push({ id: Date.now(), name, value, downpayment, installments });

            saveRealEstate();
            updateRealEstateUI();
            
            vgReForm.reset();
            const btn = vgReForm.querySelector('.btn-primary');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-check"></i> Adicionado com Sucesso!';
            btn.style.backgroundColor = 'var(--accent-green)';
            setTimeout(() => { btn.innerHTML = originalText; btn.style.backgroundColor = ''; }, 2000);
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
