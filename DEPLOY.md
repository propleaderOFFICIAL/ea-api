# Guida Deploy EA API su Vercel + Redis

## Panoramica

Questa guida spiega come deployare il server EA API su Vercel con Upstash Redis per garantire compatibilità universale con tutte le VPS MT4/MT5.

## Prerequisiti

- Account GitHub
- Account Vercel (gratuito)
- Account Upstash Redis (gratuito)
- Dominio personalizzato (es: avantirconsulting.com)

---

## Parte 1: Setup Upstash Redis (5 minuti)

### 1.1 Crea Database Redis

1. Vai su: https://console.upstash.com/
2. Sign up / Login
3. Click **"Create Database"**
4. Configurazione:
   - **Name:** `ea-trading`
   - **Type:** Global
   - **Primary Region:** Europe (più vicino)
5. Click **"Create"**

### 1.2 Ottieni Credenziali

1. Click sul database appena creato
2. Nella sezione **"REST API"**, copia:
   - `UPSTASH_REDIS_REST_URL` (es: https://xxx.upstash.io)
   - `UPSTASH_REDIS_REST_TOKEN` (stringa lunga)

**Salva queste credenziali!** Servono per tutti i deployment.

---

## Parte 2: Setup Repository GitHub (3 minuti)

### 2.1 Crea Repository

1. Vai su: https://github.com/new
2. **Nome:** `ea-api-vercel`
3. **Visibilità:** Private
4. **NON** inizializzare con README
5. Click **"Create repository"**

### 2.2 Push Codice

Sul tuo computer locale:

```bash
cd "/Users/matte1/Documents/Progetti Antigravity/ea-api"

# Inizializza nuovo repo per Vercel
git init vercel-deploy
cd vercel-deploy

# Copia solo file necessari
cp -r ../api ./
cp ../vercel.json ./
cp ../package-vercel.json ./package.json
cp ../.gitignore ./

# Commit
git add .
git commit -m "Initial Vercel + Redis implementation"

# Collega a GitHub
git remote add origin https://github.com/propleaderOFFICIAL/ea-api-vercel.git
git branch -M main
git push -u origin main
```

---

## Parte 3: Deploy su Vercel (per ogni EA)

Ripeti questi passaggi per ogni EA (elite-200, elite-30, elite-100, etc.)

### 3.1 Importa da GitHub

1. Vai su: https://vercel.com/new
2. Click **"Import Git Repository"**
3. Seleziona: `propleaderOFFICIAL/ea-api-vercel`
4. Click **"Import"**

### 3.2 Configura Variabili Ambiente

Prima del deploy, click su **"Environment Variables"** e aggiungi:

| Key | Value | Esempio |
|-----|-------|---------|
| `UPSTASH_REDIS_REST_URL` | [dalla dashboard Upstash] | `https://eager-pigeon-43987.upstash.io` |
| `UPSTASH_REDIS_REST_TOKEN` | [dalla dashboard Upstash] | `AavTAA...` |
| `PREFIX` | Prefisso unico per EA | `elite200_` |
| `MASTER_KEY` | Chiave master EA | `master_secret_key_2024` |
| `SLAVE_KEY` | Chiave slave EA | `slave_access_key_2025_08` |

**IMPORTANTE:** Cambia `PREFIX` per ogni EA:
- Elite-200: `elite200_`
- Elite-30: `elite30_`
- Elite-100: `elite100_`
- Elite-AI: `eliteai_`

### 3.3 Deploy

1. Click **"Deploy"**
2. Attendi 1-2 minuti
3. Vercel ti dà un URL tipo: `https://ea-api-vercel.vercel.app`

### 3.4 Testa il Deploy

Apri nel browser:
```
https://ea-api-vercel.vercel.app/api/health
```

Dovresti vedere:
```json
{
  "status": "online",
  "pendingOrders": 0,
  "filledTrades": 0,
  ...
}
```

---

## Parte 4: Configura Custom Domain (10 minuti)

### 4.1 Aggiungi Domain su Vercel

Per ogni progetto Vercel:

1. Vai su progetto → **Settings** → **Domains**
2. Click **"Add"**
3. Inserisci subdomain:
   - Elite-200: `elite-200.avantirconsulting.com`
   - Elite-30: `elite-30.avantirconsulting.com`
   - Elite-100: `elite-100.avantirconsulting.com`
   - Elite-AI: `elite-ai.avantirconsulting.com`
4. Click **"Add"**

Vercel ti mostrerà il record DNS da configurare.

### 4.2 Configura DNS

Sul tuo provider DNS (Cloudflare, GoDaddy, etc.):

**Per ogni subdomain, aggiungi record CNAME:**

| Type | Name | Value |
|------|------|-------|
| CNAME | elite-200 | cname.vercel-dns.com |
| CNAME | elite-30 | cname.vercel-dns.com |
| CNAME | elite-100 | cname.vercel-dns.com |
| CNAME | elite-ai | cname.vercel-dns.com |

**Se usi Cloudflare:**
- Disabilita proxy (icona grigia, non arancione)

### 4.3 Verifica SSL

Dopo 5-10 minuti:
1. Torna su Vercel → Settings → Domains
2. Dovresti vedere: **"Valid Configuration"** con icona verde
3. SSL certificato automatico

Testa nel browser:
```
https://elite-200.avantirconsulting.com/api/health
```

---

## Parte 5: Configura MT4/MT5 (per utenti finali)

### 5.1 Whitelist

Gli utenti devono aggiungere alla whitelist MT4/MT5:

**Tools → Options → Expert Advisors → Allow WebRequest for listed URL**

Aggiungi (in base all'EA):
```
https://elite-200.avantirconsulting.com
https://elite-30.avantirconsulting.com
https://elite-100.avantirconsulting.com
https://elite-ai.avantirconsulting.com
```

**IMPORTANTE:** Senza `/api/` o `/` alla fine!

### 5.2 Riavvia MT4/MT5

Dopo aver aggiunto alla whitelist, **riavviare completamente** MT4/MT5.

### 5.3 Carica EA

Compilare e caricare l'EA normalmente. Nel Journal dovrebbe apparire:
```
✅ Connessione server OK
✅ Autenticazione OK
```

---

## Riepilogo Deployment Multi-EA

| EA | Vercel Project | Custom Domain | Prefix | Status |
|----|----------------|---------------|--------|--------|
| Elite-200 | ea-api-elite200 | elite-200.avantirconsulting.com | elite200_ | Deploy |
| Elite-30 | ea-api-elite30 | elite-30.avantirconsulting.com | elite30_ | Deploy |
| Elite-100 | ea-api-elite100 | elite-100.avantirconsulting.com | elite100_ | Deploy |
| Elite-AI | ea-api-eliteai | elite-ai.avantirconsulting.com | eliteai_ | Deploy |

**Tutti usano lo stesso database Redis con prefissi diversi.**

---

## Testing

### Test Endpoint

Per ogni deployment:

```bash
# Health check
curl https://elite-200.avantirconsulting.com/api/health

# Verify slave key
curl -X POST https://elite-200.avantirconsulting.com/api/verify-slave \
  -H "Content-Type: application/json" \
  -d '{"slavekey":"slave_access_key_2025_08"}'

# Get signals (con chiave)
curl "https://elite-200.avantirconsulting.com/api/getsignals?slavekey=slave_access_key_2025_08"
```

### Test MT4

Usare lo script [`TestCustomDomain.mq4`](TestCustomDomain.mq4):
1. Modificare URL nell'input
2. Compilare
3. Eseguire su MT4
4. Verificare nel Journal

---

## Troubleshooting

### Errore: "Module not found: @upstash/redis"

**Causa:** Dipendenze non installate

**Soluzione:**
```bash
npm install @upstash/redis
git add package.json package-lock.json
git commit -m "Add Upstash Redis dependency"
git push
```

### Errore: "UPSTASH_REDIS_REST_URL is not defined"

**Causa:** Variabili ambiente non configurate

**Soluzione:**
1. Vercel dashboard → Settings → Environment Variables
2. Aggiungi tutte le variabili da `.env.example`
3. Redeploy

### DNS non propaga

**Causa:** Cache DNS o configurazione errata

**Soluzione:**
- Verifica CNAME su provider DNS
- Attendi 10-30 minuti
- Usa `nslookup` per verificare
- Se usi Cloudflare, disabilita proxy

### MT4 da errore 5203

**Causa:** Whitelist non configurata o MT4 non riavviato

**Soluzione:**
1. Verifica whitelist contiene dominio custom
2. Riavvia MT4 completamente
3. Ricarica EA

### Cold Start lento

**Causa:** Prima richiesta dopo inattività

**Soluzione:**
- Normale su Vercel (300-500ms)
- Considerare Vercel Pro se critico
- Oppure: cron job che fa ping ogni 5 minuti

---

## Monitoraggio

### Vercel Dashboard

- **Analytics:** Requests, latency, errors
- **Logs:** Real-time function logs
- **Usage:** Bandwidth, function executions

### Upstash Dashboard

- **Metrics:** Commands/day, storage
- **Data Browser:** Visualizza dati Redis
- **Logs:** Operazioni Redis

---

## Manutenzione

### Aggiornare il Codice

```bash
# Modifica file
git add .
git commit -m "Update: descrizione modifiche"
git push

# Vercel autodeploy in 1-2 minuti
```

### Pulire Dati Redis

Usare endpoint `/api/reset` con chiave master:

```bash
curl -X POST https://elite-200.avantirconsulting.com/api/reset \
  -H "Content-Type: application/json" \
  -d '{"masterkey":"master_secret_key_2024"}'
```

### Monitoring Slave Connessi

```bash
curl https://elite-200.avantirconsulting.com/api/stats
```

---

## Costi Previsti

| Servizio | Free Tier | Limite | Costo Upgrade |
|----------|-----------|--------|---------------|
| **Vercel** | Illimitato | 100 GB bandwidth/mese | $20/mese (Pro) |
| **Upstash Redis** | 10,000 comandi/giorno | ~50k se 3 EA | $10/mese (illimitato) |
| **Custom Domain** | Già posseduto | - | - |

**Totale stimato:** $0-10/mese (probabilmente serve upgrade Redis)

---

## Note Importanti

1. **Backup:** Redis data non ha backup automatico nel free tier. Considerare export periodici.
2. **Latenza:** Vercel edge network minimizza latenza (~50-150ms).
3. **Scalabilità:** Supporta migliaia di slave senza problemi.
4. **Sicurezza:** HTTPS automatico, chiavi API, rate limiting Vercel.

---

## Supporto

Per problemi:
1. Controlla Vercel logs
2. Controlla Upstash metrics
3. Testa endpoint con curl
4. Usa script TestCustomDomain.mq4 per diagnostica MT4
