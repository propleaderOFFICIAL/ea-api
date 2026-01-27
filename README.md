# EA Trading API - Versione Originale

Server API Express per sincronizzazione segnali trading tra Expert Advisor Master e Slave su MetaTrader 4/5.

## Struttura

```
ea-api/
├── server.js          # Server Express principale (in-memory)
├── api/               # Funzioni Vercel con Redis (se serve)
│   ├── lib/
│   │   ├── redis.js   # Redis adapter
│   │   └── auth.js    # Authentication
│   └── ...            # Endpoint API
├── package.json
└── vercel.json        # Config Vercel (se usi api/)
```

## Due Versioni Disponibili

### 1. `server.js` - Express In-Memory
- **Uso**: Server semplice sempre attivo
- **Storage**: In-memory (Map/Array)
- **Deploy**: Render, Railway, VPS, Fly.io
- **Quando usare**: Un solo server, nessun bisogno di persistenza

### 2. `api/` - Vercel + Redis
- **Uso**: Serverless con storage persistente
- **Storage**: Upstash Redis
- **Deploy**: Vercel
- **Quando usare**: Multi-istanza, storage condiviso, scalabilità

## Quick Start

### Con server.js (Render/Railway)

```bash
# Installa dipendenze
npm install

# Avvia
node server.js
```

Vedi `ea-trading-api-render/DEPLOY.md` per deploy su Render.

### Con api/ (Vercel)

Vedi `ea-api-vercel/README.md` per istruzioni complete.

## Endpoint API

Tutti gli endpoint sono identici tra le due versioni:

- `GET /api/health` - Health check
- `POST /api/signals` - Master invia segnali
- `GET /api/getsignals?slavekey=KEY` - Slave riceve segnali
- `POST /api/verify-slave` - Verifica chiave slave
- `POST /api/reset` - Reset completo
- `GET /api/stats` - Statistiche

## Note

- `server.js` ha chiavi hardcoded (modifica nel file se necessario)
- `api/` usa variabili d'ambiente (più sicuro)
- Entrambe le versioni supportano gli stessi endpoint
