"""
Family Office — Motor de Cotações em Tempo Real
Servidor Flask que consulta Yahoo Finance e serve dados ao Dashboard.
Também serve os arquivos estáticos (HTML/CSS/JS) para acesso via túnel.
"""

import os
import json
import hashlib
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import yfinance as yf
import threading
import time
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()

# Diretório onde ficam os arquivos estáticos (index.html, style.css, app.js)
STATIC_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__, static_folder=None)
CORS(app)


# ─── Servir arquivos estáticos (Dashboard) ───────────────────────────────────
@app.route('/')
def serve_index():
    return send_from_directory(STATIC_DIR, 'index.html')

@app.route('/style.css')
def serve_css():
    return send_from_directory(STATIC_DIR, 'style.css')

@app.route('/app.js')
def serve_js():
    return send_from_directory(STATIC_DIR, 'app.js')


# ─── Persistência de Ativos (MongoDB ou JSON Local) ─────────────────────────────
ASSETS_FILE = os.path.join(STATIC_DIR, 'assets_data.json')
MONGO_URI = os.getenv('MONGO_URI')

_assets_lock = threading.Lock()
_assets_version = 0  # Incrementado a cada modificação

# Configura MongoDB se houver URI
mongo_client = None
mongo_db = None
mongo_col = None

if MONGO_URI:
    try:
        mongo_client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
        mongo_client.admin.command('ping') # Testa a conexão
        mongo_db = mongo_client['family_office']
        mongo_col = mongo_db['portfolio']
        print("[INIT] Conectado ao MongoDB com sucesso!")
    except Exception as e:
        print(f"[INIT ERROR] Falha ao conectar no MongoDB. Usando JSON local. Erro: {e}")
        mongo_client = None

def _load_assets():
    """Carrega ativos do MongoDB (nuvem) ou do arquivo JSON (local)."""
    if mongo_client is not None and mongo_col is not None:
        try:
            doc = mongo_col.find_one({"_id": "assets_data"})
            if doc and 'assets' in doc:
                return doc['assets']
            return []
        except Exception as e:
            print(f"[MONGO ERROR] Erro ao carregar ativos: {e}")
            return []

    # Fallback para JSON local
    if os.path.exists(ASSETS_FILE):
        try:
            with open(ASSETS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return []
    return []


def _save_assets(assets_list):
    """Salva ativos no MongoDB ou no arquivo JSON e incrementa a versão."""
    global _assets_version
    
    if mongo_client is not None and mongo_col is not None:
        try:
             mongo_col.update_one(
                 {"_id": "assets_data"}, 
                 {"$set": {"assets": assets_list}}, 
                 upsert=True
             )
        except Exception as e:
             print(f"[MONGO ERROR] Erro ao salvar ativos: {e}")
    else:
        # Fallback para JSON local
        with open(ASSETS_FILE, 'w', encoding='utf-8') as f:
            json.dump(assets_list, f, ensure_ascii=False, indent=2)
            
    _assets_version += 1


# ─── Endpoint: Obter todos os ativos ─────────────────────────────────────────
@app.route('/api/assets')
def get_assets():
    """GET /api/assets → retorna lista de ativos + versão atual."""
    with _assets_lock:
        assets = _load_assets()
    return jsonify({'assets': assets, 'version': _assets_version})


# ─── Endpoint: Checar versão (polling leve) ──────────────────────────────────
@app.route('/api/assets/version')
def get_assets_version():
    """GET /api/assets/version → retorna apenas a versão (polling eficiente)."""
    return jsonify({'version': _assets_version})


# ─── Endpoint: Salvar todos os ativos (bulk replace) ─────────────────────────
@app.route('/api/assets', methods=['POST'])
def save_assets():
    """
    POST /api/assets  body: { "assets": [...] }
    Substitui toda a lista de ativos.
    """
    try:
        body = request.get_json()
        assets_list = body.get('assets', [])
        with _assets_lock:
            _save_assets(assets_list)
        return jsonify({'success': True, 'version': _assets_version, 'count': len(assets_list)})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ─── Endpoint: Adicionar um ativo ────────────────────────────────────────────
@app.route('/api/assets/add', methods=['POST'])
def add_asset():
    """
    POST /api/assets/add  body: { asset data }
    Adiciona ou funde um ativo na lista.
    """
    try:
        new_asset = request.get_json()
        with _assets_lock:
            assets = _load_assets()
            
            # Verifica merge por ticker
            ticker = (new_asset.get('ticker') or '').upper()
            existing_idx = None
            for i, a in enumerate(assets):
                if (a.get('ticker') or '').upper() == ticker and ticker:
                    existing_idx = i
                    break
            
            if existing_idx is not None:
                # Merge: preço médio ponderado
                existing = assets[existing_idx]
                old_qty = existing.get('quantity', 0)
                new_qty = new_asset.get('quantity', 0)
                total_qty = old_qty + new_qty
                new_avg = ((old_qty * existing.get('avgPrice', 0)) + (new_qty * new_asset.get('avgPrice', 0))) / total_qty if total_qty > 0 else 0
                
                existing['quantity'] = total_qty
                existing['avgPrice'] = new_avg
                existing['value'] = total_qty * new_avg
                existing['currentPrice'] = new_asset.get('currentPrice', existing.get('currentPrice', 0))
                existing['simulatedCurrent'] = total_qty * existing['currentPrice']
                existing['name'] = new_asset.get('name', existing.get('name', ''))
            else:
                assets.append(new_asset)
            
            _save_assets(assets)
        return jsonify({'success': True, 'version': _assets_version})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ─── Endpoint: Deletar um ativo ──────────────────────────────────────────────
@app.route('/api/assets/<int:asset_id>', methods=['DELETE'])
def delete_asset(asset_id):
    """DELETE /api/assets/123456 → remove ativo com aquele ID."""
    try:
        with _assets_lock:
            assets = _load_assets()
            assets = [a for a in assets if a.get('id') != asset_id]
            _save_assets(assets)
        return jsonify({'success': True, 'version': _assets_version})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ─── Cache simples em memória para evitar spam na API do Yahoo ───────────────
_quote_cache = {}
_CACHE_TTL = 120  # 2 minutos

def _get_cached_quote(ticker):
    """Retorna cotação cacheada se ainda válida, senão None."""
    entry = _quote_cache.get(ticker)
    if entry and (time.time() - entry['ts']) < _CACHE_TTL:
        return entry['data']
    return None

def _set_cached_quote(ticker, data):
    _quote_cache[ticker] = {'data': data, 'ts': time.time()}


# ─── Endpoint: Busca de Ativos (Autocomplete) ───────────────────────────────
@app.route('/api/search/<query>')
def search_ticker(query):
    """
    Pesquisa tickers no Yahoo Finance.
    GET /api/search/petr  →  lista de ativos com nome e ticker
    """
    try:
        results = []
        # Busca usando yfinance search
        search = yf.Search(query, max_results=8)
        
        if hasattr(search, 'quotes') and search.quotes:
            for item in search.quotes:
                symbol = item.get('symbol', '')
                name = item.get('shortname') or item.get('longname') or item.get('shortName') or item.get('longName') or symbol
                exchange = item.get('exchange', '')
                qtype = item.get('quoteType', '')
                
                results.append({
                    'symbol': symbol,
                    'name': name,
                    'exchange': exchange,
                    'type': qtype
                })

        return jsonify({'results': results})

    except Exception as e:
        print(f"[SEARCH ERROR] {e}")
        return jsonify({'results': [], 'error': str(e)}), 200


# ─── Endpoint: Cotação Atual de um Ticker ────────────────────────────────────
@app.route('/api/quote/<ticker>')
def get_quote(ticker):
    """
    Retorna dados de cotação de um ticker.
    GET /api/quote/PETR4.SA  →  { price, previousClose, name, currency, ... }
    """
    try:
        ticker = ticker.upper()
        
        # Checa cache
        cached = _get_cached_quote(ticker)
        if cached:
            return jsonify(cached)
        
        stock = yf.Ticker(ticker)
        info = stock.info
        
        # Busca preço atual ou último fechamento
        current_price = info.get('currentPrice') or info.get('regularMarketPrice') or info.get('previousClose', 0)
        previous_close = info.get('previousClose') or info.get('regularMarketPreviousClose', 0)
        
        data = {
            'symbol': ticker,
            'name': info.get('shortName') or info.get('longName') or ticker,
            'price': current_price,
            'previousClose': previous_close,
            'currency': info.get('currency', 'BRL'),
            'exchange': info.get('exchange', ''),
            'marketCap': info.get('marketCap', 0),
            'sector': info.get('sector', ''),
            'type': info.get('quoteType', 'EQUITY'),
            'fiftyTwoWeekHigh': info.get('fiftyTwoWeekHigh', 0),
            'fiftyTwoWeekLow': info.get('fiftyTwoWeekLow', 0),
            'dayHigh': info.get('dayHigh', 0),
            'dayLow': info.get('dayLow', 0),
            'volume': info.get('volume', 0),
            'success': True
        }
        
        _set_cached_quote(ticker, data)
        return jsonify(data)

    except Exception as e:
        print(f"[QUOTE ERROR] {ticker}: {e}")
        return jsonify({
            'symbol': ticker,
            'price': 0,
            'previousClose': 0,
            'success': False,
            'error': str(e)
        }), 200


# ─── Endpoint: Cotação Múltipla (Bulk) ───────────────────────────────────────
@app.route('/api/quotes', methods=['POST'])
def get_bulk_quotes():
    """
    Recebe lista de tickers e retorna cotações de todos.
    POST /api/quotes  body: { "tickers": ["PETR4.SA", "VALE3.SA"] }
    """
    try:
        body = request.get_json()
        tickers = body.get('tickers', [])
        
        results = {}
        for t in tickers:
            t = t.upper()
            cached = _get_cached_quote(t)
            if cached:
                results[t] = cached
                continue
            
            try:
                stock = yf.Ticker(t)
                info = stock.info
                current_price = info.get('currentPrice') or info.get('regularMarketPrice') or info.get('previousClose', 0)
                previous_close = info.get('previousClose') or info.get('regularMarketPreviousClose', 0)
                
                data = {
                    'symbol': t,
                    'name': info.get('shortName') or info.get('longName') or t,
                    'price': current_price,
                    'previousClose': previous_close,
                    'currency': info.get('currency', 'BRL'),
                    'type': info.get('quoteType', 'EQUITY'),
                    'success': True
                }
                _set_cached_quote(t, data)
                results[t] = data
            except Exception as inner_e:
                results[t] = {'symbol': t, 'price': 0, 'success': False, 'error': str(inner_e)}
        
        return jsonify({'quotes': results})

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ─── Endpoint: Health Check ──────────────────────────────────────────────────
@app.route('/api/health')
def health():
    return jsonify({'status': 'online', 'message': 'Motor de cotações rodando.'})


# ─── Endpoint: Live Reload (detecta mudanças nos arquivos de código) ─────────
_WATCH_FILES = ['index.html', 'style.css', 'app.js']

def _get_files_hash():
    """Gera um hash baseado no mtime dos arquivos monitorados."""
    mtimes = []
    for fname in _WATCH_FILES:
        fpath = os.path.join(STATIC_DIR, fname)
        try:
            mtimes.append(str(os.path.getmtime(fpath)))
        except OSError:
            mtimes.append('0')
    combined = '|'.join(mtimes)
    return hashlib.md5(combined.encode()).hexdigest()[:12]

@app.route('/api/files/version')
def files_version():
    """GET /api/files/version → hash dos arquivos de código para live reload."""
    return jsonify({'hash': _get_files_hash()})


# ─── Run ─────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    # Inicializa arquivo de ativos se não existir
    if not os.path.exists(ASSETS_FILE):
        _save_assets([])
        print(f"[INIT] Arquivo de ativos criado: {ASSETS_FILE}")
    else:
        existing = _load_assets()
        print(f"[INIT] {len(existing)} ativo(s) carregado(s) de {ASSETS_FILE}")

    print("\n+----------------------------------------------------------+")
    print("|   Family Office - Motor de Cotacoes em Tempo Real       |")
    print("|   Escutando na porta 5000...                            |")
    print("|   Endpoints:                                            |")
    print("|     GET  /api/assets           -> Lista de ativos       |")
    print("|     POST /api/assets           -> Salvar ativos         |")
    print("|     POST /api/assets/add       -> Adicionar ativo       |")
    print("|     DEL  /api/assets/<id>      -> Deletar ativo         |")
    print("|     GET  /api/assets/version   -> Versao (polling)      |")
    print("|     GET  /api/search/<query>   -> Busca de tickers      |")
    print("|     GET  /api/quote/<ticker>   -> Cotacao individual    |")
    print("|     POST /api/quotes           -> Cotacoes em massa     |")
    print("|     GET  /api/health           -> Status do servidor    |")
    print("+----------------------------------------------------------+\n")
    app.run(host='0.0.0.0', port=5000, debug=False)
