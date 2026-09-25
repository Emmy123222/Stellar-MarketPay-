# 🚀 Quickstart Checklist

Get Stellar MarketPay up and running in under 5 minutes. This guide is designed for speed—just copy, paste, and go!

---

### 1️⃣ Clone the Repository (< 1 min)
Get the code onto your local machine.
```bash
git clone https://github.com/Emmy123222/Stellar-MarketPay-.git
cd Stellar-MarketPay-
```

### 2️⃣ Environment Setup (< 1 min)
Copy the example environment files for both frontend and backend.
```bash
# Frontend env
cp frontend/.env.example frontend/.env.local

# Backend env
cp backend/.env.example backend/.env
```
> *Note: The default variables in `.env.example` are pre-configured for local testnet development.*

### 3️⃣ Start Infrastructure (< 1 min)
Spin up the database (PostgreSQL) and Redis using Docker Compose.
```bash
docker-compose up -d postgres redis
```
> *Wait a few seconds for the database to be ready before starting the backend.*

### 4️⃣ Start the Backend (< 1 min)
Install dependencies and start the Node.js API.
```bash
cd backend
npm install
npm run dev
```
> *The backend will be running at http://localhost:4000*

### 5️⃣ Start the Frontend (< 1 min)
In a **new terminal window**, install dependencies and start the Next.js app.
```bash
cd frontend
npm install
npm run dev
```
> *The frontend will be running at http://localhost:3000*

---

## 🛑 What Went Wrong? (Common Fixes)

**❌ `docker-compose: command not found`**
* **Fix**: You need to install Docker Desktop. Alternatively, try running `docker compose` (without the hyphen).

**❌ Database connection refused on backend startup**
* **Fix**: Ensure your Docker containers are running (`docker ps`). If postgres is restarting, check the logs: `docker logs <container_id>`. Make sure port 5432 is not being used by a local PostgreSQL installation.

**❌ Port 3000 or 4000 is already in use**
* **Fix**: Kill the process using the port.
  * Mac/Linux: `lsof -i :3000` then `kill -9 <PID>`
  * Windows: `netstat -ano | findstr :3000` then `taskkill /PID <PID> /F`

**❌ Soroban contract mock errors in frontend**
* **Fix**: Ensure `NEXT_PUBLIC_USE_CONTRACT_MOCK=true` is set in your `frontend/.env.local` if you haven't deployed the Soroban contracts locally yet.
