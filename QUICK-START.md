# Quick Start Guide - EA API Vercel

Guida rapida per deployare il server in 15 minuti.

## Step 1: Setup Upstash Redis (5 minuti)

1. Vai su https://console.upstash.com/
2. Sign up (gratuito)
3. **Create Database**:
   - Name: `ea-trading`
   - Type: Global
   - Region: Europe
4. Copia credenziali dalla sezione **REST API**:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

## Step 2: Setup GitHub (2 minuti)

1. Crea repository su GitHub: `ea-api-vercel`
2. Clone sul computer locale
3. Copia file:
   ```bash
   cp -r api/ [tuo-repo]/
   cp vercel.json [tuo-repo]/
   cp package-vercel.json [tuo-repo]/package.json
   cp .gitignore [tuo-repo]/
   ```
4. Push:
   ```bash
   cd [tuo-repo]
   git add .
   git commit -m "Initial commit"
   git push
   ```

## Step 3: Deploy su Vercel (5 minuti)

### Per OGNI EA ripeti:

1. Vai su https://vercel.com/new
2. Import repository: `ea-api-vercel`
3. **Environment Variables** (aggiungi tutte):
   ```
   UPSTASH_REDIS_REST_URL=https://eager-pigeon-43987.upstash.io
   UPSTASH_REDIS_REST_TOKEN=AavTAA...
   PREFIX=elite200_
   MASTER_KEY=master_secret_key_2024
   SLAVE_KEY=slave_access_key_2025_08
   ```
4. Click **Deploy**
5. Attendi 1-2 minuti

**IMPORTANTE:** Cambia `PREFIX` per ogni EA:
- Elite-200: `PREFIX=elite200_`
- Elite-30: `PREFIX=elite30_`
- Elite-100: `PREFIX=elite100_`

### 3.2 Aggiungi Custom Domain

1. Settings → Domains
2. Add: `elite-200.avantirconsulting.com`
3. Configura CNAME sul tuo DNS provider:
   ```
   Type: CNAME
   Name: elite-200
   Value: cname.vercel-dns.com
   ```
4. Attendi 10 minuti per propagazione

### 3.3 Verifica

Apri browser:
```
https://elite-200.avantirconsulting.com/api/health
```

Dovresti vedere:
```json
{"status":"online",...}
```

## Step 4: Configura EA (3 minuti)

### 4.1 Aggiorna URL nell'EA

Nel file `code_ea.mq4`, cambia:

```mql4
input string link4 = "https://elite-200.avantirconsulting.com/api/";
```

### 4.2 Compila

- MetaEditor (F4)
- Compile (F7)
- Verifica: 0 errors

### 4.3 Whitelist MT4

**Tools → Options → Expert Advisors**

Aggiungi:
```
https://elite-200.avantirconsulting.com
```

Riavvia MT4.

## Step 5: Test (2 minuti)

1. Carica EA su grafico MT4
2. Controlla Journal:
   ```
   ✅ Connessione server OK
   ✅ Autenticazione OK
   ```

---

## Deployment Multipli

Ripeti Step 3 per ogni EA con PREFIX diverso:

| EA | Vercel Project | Custom Domain | PREFIX |
|----|----------------|---------------|--------|
| Elite-200 | ea-api-elite200 | elite-200.avantirconsulting.com | elite200_ |
| Elite-30 | ea-api-elite30 | elite-30.avantirconsulting.com | elite30_ |
| Elite-100 | ea-api-elite100 | elite-100.avantirconsulting.com | elite100_ |

Tutti condividono lo stesso Redis database!

---

## Test Veloci

```bash
# Health check
curl https://elite-200.avantirconsulting.com/api/health

# Get signals
curl "https://elite-200.avantirconsulting.com/api/getsignals?slavekey=slave_access_key_2025_08"
```

---

## Troubleshooting Rapido

**Errore: Module not found**
```bash
npm install
git add package-lock.json
git push
```

**DNS non funziona**
- Attendi 10-30 minuti
- Verifica CNAME su DNS provider

**MT4 errore 5203**
- Aggiungi dominio a whitelist
- Riavvia MT4

**Redis error**
- Verifica credenziali in Environment Variables
- Redeploy dopo modifiche

---

## Prossimi Passi

Leggi [DEPLOY.md](DEPLOY.md) per istruzioni complete e troubleshooting avanzato.
