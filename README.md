# AeroFlow — Platformă de Livrări Autonome cu Drone

AeroFlow este o aplicație web full-stack dezvoltată în cadrul lucrării de licență, având ca scop gestionarea și simularea livrărilor autonome cu drone pe teritoriul României.

---

## Cuprins

- [Prezentare Generală](#prezentare-generală)
- [Funcționalități Principale](#funcționalități-principale)
- [Tehnologii Utilizate](#tehnologii-utilizate)
- [Arhitectură](#arhitectură)
- [Structura Proiectului](#structura-proiectului)
- [Instalare și Configurare](#instalare-și-configurare)
- [Configurare Variabile de Mediu](#configurare-variabile-de-mediu)
- [Pornirea Aplicației](#pornirea-aplicației)
- [Conturi Demo](#conturi-demo)
- [Roluri și Permisiuni](#roluri-și-permisiuni)
- [Documentația API](#documentația-api)
- [Pagini Frontend](#pagini-frontend)
- [Modele de Date](#modele-de-date)
- [Servicii Principale](#servicii-principale)
- [Scenarii Demo](#scenarii-demo)
- [Testare](#testare)
- [Documentație Suplimentară](#documentație-suplimentară)

---

## Prezentare Generală

AeroFlow este un sistem de gestionare a livrărilor cu drone, care simulează zboruri pe teritoriul României. Platforma acoperă mai multe etape ale unei livrări — de la plasarea comenzii de către client, la alocarea dronei, planificarea rutei (cu algoritmul A* și evitarea zonelor restricționate), simularea deplasării cu gestionarea bateriei, influența condițiilor meteorologice, opriri la stații de încărcare și confirmarea livrării prin cod de verificare (Proof of Delivery).

Sistemul preia **date meteorologice** de la API-ul public Meteoromania (ANM) și afișează pozițiile dronelor pe o hartă interactivă prin actualizări WebSocket.

---

## Funcționalități Principale

- **Simulare și Hartă:** Urmărirea dronelor în timp real pe o hartă interactivă Leaflet, cu actualizări WebSocket pentru poziție, baterie și viteză.
- **Modelare Fizică și Meteo:** Baterie cu degradare, consum variabil în funcție de greutate și meteo preluat prin API de la ANM. Redirecționare automată la stații de încărcare.
- **Navigație și Rutare:** Algoritm A* pe o grilă de 1000×2000 pentru evitarea dinamică a zonelor restricționate (NFZ) și planificarea lanțurilor de încărcare multi-hop.
- **Gestionarea Livrărilor:** Ciclu de viață complet, alocare pe bază de multi-criterii, sistem de priorități și Confirmare a Livrării (cod PIN, URL foto și note).
- **Monitorizare și Audit:** Dashboard-uri cu indicatori, jurnal de audit, alerte de sistem (baterie, meteo) și reluarea (replay) zborurilor finalizate.
- **Securitate și Roluri:** Acces bazat pe roluri (Admin, Dispecer, Client), token-uri JWT, limitarea ratei de cereri (rate limiting) și resetare parolă prin email.
- **Scenarii Demo:** 7 scenarii predefinite pentru testarea platformei (vreme nefavorabilă, baterie critică, etc.).

---

## Tehnologii Utilizate

| Nivel           | Tehnologie                                                      |
| --------------- | --------------------------------------------------------------- |
| **Backend**     | Python 3.11+ · FastAPI · SQLAlchemy · Uvicorn                   |
| **Baza de date**| PostgreSQL (mediul normal) · SQLite in-memory (testare automată)|
| **Frontend**    | React 19 · React Router 7 · Leaflet / React-Leaflet · Recharts |
| **Autentificare** | JWT (PyJWT / python-jose) · bcrypt · passlib                  |
| **Timp real**   | WebSocket (nativ FastAPI)                                       |
| **Meteo**       | API-ul public Meteoromania (ANM)                                |
| **Email**       | SMTP (smtplib) cu STARTTLS/SSL                                  |
| **Rutare**      | Pathfinding A* pe grilă cu string pulling                       |
| **Iconuri**     | Lucide React                                                    |
| **HTTP**        | Axios (frontend) · Requests (backend)                           |
| **Testare**     | pytest · httpx · @testing-library/react · Jest                  |
| **Rate Limit**  | slowapi                                                         |

> **Notă:** Aplicația folosește PostgreSQL în mediul normal de rulare, iar SQLite in-memory este utilizat pentru testare automată.

---

## Arhitectură

```
┌──────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React 19)                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │  Context  │  │ Dashboard│  │  Hartă   │  │ Analiză / Audit  │ │
│  │  Auth     │  │ (per rol)│  │ (Leaflet)│  │ Misiuni / Alerte │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────────┬─────────┘ │
│       └──────────────┴─────────────┴─────────────────┘           │
│                         │ REST API + WebSocket                    │
├──────────────────────────────────────────────────────────────────┤
│                        BACKEND (FastAPI)                          │
│  ┌──────────┐  ┌───────────┐  ┌────────────┐  ┌──────────────┐  │
│  │  Rute    │  │  Servicii │  │  Simulator │  │  Servicii    │  │
│  │  (16)    │  │  (27)     │  │  (Thread)  │  │  Background  │  │
│  └────┬─────┘  └─────┬─────┘  └─────┬──────┘  └──────┬───────┘  │
│       └──────────────┬┴──────────────┴─────────────────┘         │
│                      │ SQLAlchemy ORM                             │
│  ┌───────────────────┴──────────────────────────────────────────┐│
│  │            BAZA DE DATE (PostgreSQL / SQLite)                  ││
│  │  users · drones · deliveries · missions · alerts              ││
│  │  audit_logs · no_fly_zones · charging_stations · mission_events ││
│  └──────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

### Servicii de fundal (pornite automat la start)
- **Simulatorul de Drone** — deplasează dronele pe rute la fiecare 0.5s, gestionează consumul de baterie, încărcarea și finalizarea livrărilor
- **Serviciul Meteo** — preia date meteorologice de la ANM la fiecare 10 minute
- **Serviciul de Avertizare** — monitorizează flota de drone pentru anomalii și creează alerte de sistem
- **Reîmprospătarea Radarului** — actualizare în fundal a datelor radar la fiecare 2 minute

---

## Structura Proiectului

```
├── backend/
│   ├── main.py                 # Punctul de intrare FastAPI
│   ├── database.py & migrations.py # Baza de date și sistemul propriu de migrări
│   ├── app/core/               # Mașina de stări (enum-uri și tranziții)
│   ├── models/                 # Modele ORM SQLAlchemy (User, Drone, Delivery etc.)
│   ├── routes/                 # Endpoint-uri API grupate pe domenii (16 routere)
│   ├── schemas/                # Scheme de validare Pydantic
│   ├── services/               # Logica de afaceri, simulator și background tasks (27+ servicii)
│   └── data/                   # Fisiere configurare (ex: settings.json)
├── frontend/
│   ├── public/                 # Fișiere statice
│   └── src/
│       ├── App.js & .css       # Aplicația principală și stilurile globale
│       ├── context/            # Starea globală (AuthContext)
│       ├── hooks/              # Custom React hooks (WebSocket, notificări)
│       ├── services/           # Comunicarea cu backend-ul (Axios)
│       ├── utils/              # Funcții utilitare (formatare dată, procesare foto)
│       └── components/         # Peste 40 de componente React (Dashboards, Hartă, etc.)
├── tests/                      # Teste de integrare (pytest)
└── docs/                       # Documentație suplimentară și ghiduri
```

---

## Instalare și Configurare

### Cerințe Minime de Sistem (Hardware)

Pentru a rula fluent ambele componente (simulatorul Python și interfața React) local, se recomandă:
- **Sistem de operare:** Windows 10/11, macOS sau Linux
- **Procesor (CPU):** Minim 2 nuclee (recomandat 4 nuclee datorită motorului de simulare `tick_loop`)
- **Memorie (RAM):** Minim 4 GB (recomandat 8 GB pentru rularea simultană a bazei de date)
- **Spațiu stocare:** 500 MB (fără a include instalarea PostgreSQL/Node)

### Cerințe Software (Prealabile)

- **Python** 3.11+
- **Node.js** 18+ și **npm**
- **PostgreSQL** 15+ (recomandat) sau SQLite (fallback automat)

### 1. Clonarea Depozitului

```bash
git clone <url-depozit>
cd AeroFlow
```

### 2. Configurare Backend

```bash
# Crearea și activarea mediului virtual
python -m venv venv

# Windows
venv\Scripts\activate
# Linux/macOS
source venv/bin/activate

# Instalarea dependențelor Python
pip install -r requirements.txt
```

### 3. Configurare Frontend

```bash
cd frontend
npm install
cd ..
```

### 4. Configurare Bază de Date (PostgreSQL)

```sql
-- Crearea bazei de date
CREATE DATABASE drone_platform;

-- Conexiunea implicită este:
-- postgresql://postgres:1234@localhost:5433/drone_platform
-- Ajustează în .env dacă configurația ta diferă
```

> **Notă:** Dacă PostgreSQL nu este disponibil, sistemul face fallback automat pe SQLite (`backend/drone.db`).

---

## Configurare Variabile de Mediu

Primul pas înainte de a rula proiectul este configurarea variabilelor de mediu. Sistemul se așteaptă să găsească un fișier `.env` în rădăcina proiectului.

Copiază fișierul șablon `.env.example` și redenumește-l în `.env`:

**Pe Windows (CMD / PowerShell):**
```cmd
copy .env.example .env
```

**Pe Linux / macOS:**
```bash
cp .env.example .env
```

După creare, deschide fișierul `.env` cu un editor de text și completează valorile (în special `SECRET_KEY`).

### Variabile de Mediu

| Variabilă        | Descriere                                        | Obligatoriu |
| ---------------- | ------------------------------------------------ | :---------: |
| `SECRET_KEY`     | Secret pentru semnarea JWT (șir aleatoriu)        |     Da      |
| `DATABASE_URL`   | String de conexiune PostgreSQL                   |     Nu*     |
| `SMTP_HOST`      | Server SMTP (ex. `smtp.gmail.com`)               |     Nu      |
| `SMTP_PORT`      | Port SMTP (implicit: `587`)                      |     Nu      |
| `SMTP_USER`      | Adresa de email a expeditorului                  |     Nu      |
| `SMTP_PASSWORD`  | Parolă SMTP / parolă de aplicație                |     Nu      |
| `SMTP_FROM`      | Numele afișat și adresa pentru emailuri trimise   |     Nu      |

*\* Implicit: `postgresql://postgres:1234@localhost:5433/drone_platform`*

> **Meteo:** Datele meteorologice sunt preluate automat de la Meteoromania (ANM) — **nu necesită cheie API**.  
> **Email:** Dacă variabilele SMTP nu sunt setate, trimiterea emailurilor este omisă silențios (aplicația funcționează normal).

### Setări Runtime

Configurabile prin pagina de Setări din interfața admin sau direct în `backend/data/settings.json`:

| Setare                 | Implicit | Descriere                              |
| ---------------------- | :------: | -------------------------------------- |
| `critical_battery`     |    15    | Pragul de baterie (%) pentru alerte    |
| `max_wind`             |    45    | Viteza maximă a vântului (km/h) înainte de oprirea zborurilor |
| `maintenance_interval` |   500    | Km de zbor înainte de alertă mentenanță |

---

## Pornirea Aplicației

### Pornirea Backend-ului

```bash
cd backend
uvicorn main:app --reload
```

- **API**: http://127.0.0.1:8000
- **Documentație Swagger**: http://127.0.0.1:8000/docs
- **ReDoc**: http://127.0.0.1:8000/redoc

### Pornirea Frontend-ului

```bash
cd frontend
npm start
```

- **Aplicație**: http://localhost:3000

### Ce se întâmplă la pornire

1. Tabelele bazei de date sunt create (dacă nu există)
2. Migrările de schemă sunt aplicate automat (23 de migrări)
3. Utilizatorii demo sunt creați (dacă baza de date este goală)
4. Flota de drone este inițializată (minim de drone asigurat)
5. Stațiile de încărcare sunt populate pe teritoriul României
6. Zonele restricționate implicite sunt create
7. Serviciile de fundal pornesc:
   - **Simulatorul de drone** (motor de zbor, tick la 0.5s)
   - **Serviciul meteo** (reîmprospătare API ANM la fiecare 10 min)
   - **Serviciul de avertizare** (monitorizare sănătate flotă)
   - **Reîmprospătarea radarului** (la fiecare 2 min)

---

## Conturi Demo

La prima rulare (dacă baza de date este goală), următoarele conturi sunt create automat.
> [!WARNING]
> **Aceste conturi sunt destinate exclusiv testării locale și demonstrației.** Nu utilizați aceste credențiale în medii de producție.

| Email                    | Parolă     | Rol        |
| ------------------------ | ---------- | ---------- |
| `admin@example.com`      | `Pass123!` | Admin      |
| `dispatcher@example.com` | `Pass123!` | Dispecer   |
| `customer@example.com`   | `Pass123!` | Client     |

---

## Roluri și Permisiuni

| Funcționalitate                | Admin | Dispecer | Client |
| ------------------------------ | :---: | :------: | :----: |
| Dashboard (specific rolului)   |  Da   |    Da    |   Da   |
| Plasare livrare nouă           |  Da   |    Da    |   Da   |
| Vizualizare livrări proprii    |  Da   |    Da    |   Da   |
| Hartă în timp real (completă)  |  Da   |    Da    |   Nu   |
| Hartă client (livrări proprii) |  Da   |    Da    |   Da   |
| Gestionare drone               |  Da   |    Da    |   Nu   |
| Control misiuni                |  Da   |    Da    |   Nu   |
| Istoric livrări (toate)        |  Da   |    Da    |   Nu   |
| Dashboard analiză              |  Da   |    Da    |   Nu   |
| Alerte de sistem               |  Da   |    Da    |   Nu   |
| Gestionare utilizatori         |  Da   |    Nu    |   Nu   |
| Jurnal de audit                |  Da   |    Nu    |   Nu   |
| Setări                         |  Da   |    Nu    |   Nu   |
| Scenarii demo                  |  Da   |    Da    |   Nu   |

---

## Documentația API

API-ul este auto-documentat prin Swagger UI la `/docs`. Principalele grupuri de endpoint-uri:

- **Autentificare** (`/api/auth`) — Login, înregistrare, refresh JWT, resetare parolă.
- **Livrări** (`/api/deliveries`) — CRUD, alocare automată (inclusiv în lot), reatribuire, confirmare PoD.
- **Drone** (`/api/drones`) — CRUD, actualizare status, trimitere în mentenanță.
- **Misiuni** (`/api/missions`) — Monitorizare progres, pauză/reluare, abandonare, istoric evenimente.
- **Meteo** (`/api/weather`) — Date meteo de la ANM, verificare siguranță pe rută, imagine radar.
- **Spațiu Aerian și Stații** — Gestionarea zonelor restricționate (`/api/no-fly-zones`) și a stațiilor de încărcare (`/api/charging`).
- **Alerte și Audit** — Jurnalizarea tuturor acțiunilor (`/api/audit`) și monitorizarea anomaliilor de sistem (`/api/alerts`).
- **Sistem și Simulator** — Setări runtime (`/api/settings`), declanșare scenarii demo (`/api/simulator`) și sănătatea flotei (`/api/system`).
- **WebSocket** (`/ws`) — Actualizări bidirecționale în timp real pentru pozițiile dronelor și statusul livrărilor.

---

## Pagini Frontend

| Rută               | Componentă             | Rol Necesar         | Descriere                                  |
| ------------------- | ---------------------- | ------------------- | ------------------------------------------ |
| `/login`            | Login                  | Public              | Autentificare utilizator                   |
| `/register`         | Register               | Public              | Înregistrare utilizator                    |
| `/forgot-password`  | ForgotPassword         | Public              | Flux resetare parolă                       |
| `/dashboard`        | Dashboard per rol      | Autentificat        | Dashboard Admin / Dispecer / Client        |
| `/map`              | DroneMap / CustomerMap | Autentificat        | Hartă live (completă sau doar client)      |
| `/deliveries`       | DeliveryHistory        | Admin, Dispecer     | Istoric livrări cu filtre                  |
| `/drones`           | DronesPage             | Admin, Dispecer     | Gestionare flotă drone                     |
| `/missions`         | MissionList            | Admin, Dispecer     | Control misiuni și telemetrie              |
| `/analytics`        | AnalyticsDashboard     | Admin, Dispecer     | KPI-uri, grafice și statistici             |
| `/users`            | UserManagement         | Admin               | CRUD și gestionare roluri utilizatori      |
| `/audit`            | AuditLog               | Admin               | Trasabilitate completă acțiuni             |
| `/alerts`           | SystemAlertsPage       | Admin, Dispecer     | Gestionare alerte de sistem                |
| `/settings`         | SettingsPage           | Admin               | Configurare sistem                         |

---

## Modele de Date

- **User** — Autentificare, detalii de contact și controlul accesului prin roluri (Admin, Dispecer, Client).
- **Drone** — Telemetria curentă (locație, baterie, status zbor) și metrici pe termen lung (uzura bateriei).
- **Delivery** — Ciclul de viață al pachetului, priorități (normal/urgent) și Confirmarea Livrării (PoD).
- **Mission** — Zborul propriu-zis (legătura fizică dintre Dronă și Livrare), cu urmărirea progresului și a distanțelor.
- **Alert** — Semnalarea anomaliilor de sistem (vreme severă, baterie critică) cu managementul rezolvării.
- **AuditLog** — Trasabilitatea inalterabilă a modificărilor critice din platformă.
- **NoFlyZone** — Geofencing pentru zone restricționate pe care algoritmul A* le evită automat.
- **ChargingStation** — Rețeaua punctelor de încărcare folosite pentru planificarea rutelor lungi (multi-hop).

---

## Servicii Principale

| Serviciu                | Responsabilitate                                            |
| ----------------------- | ----------------------------------------------------------- |
| `drone_simulator.py`    | Motor de simulare zbor — deplasare pas cu pas, consum baterie, încărcare, finalizare livrări, transmisiuni WebSocket |
| `delivery_service.py`   | Alocare livrări, clasament drone, tranziții de stare, alocare în lot, reatribuire, PoD |
| `weather_service.py`    | Integrare API ANM, gestionare zone meteo, calcul impact meteo |
| `battery_service.py`    | Calcul consum baterie, încărcare, degradare, estimare autonomie |
| `fleet_optimizer.py`    | Selecție dronă pe baza mai multor criterii (distanță, baterie, sănătate, meteo, marjă autonomie) |
| `grid.py`               | Pathfinding A* pe grilă 1000×2000 celule acoperind România   |
| `charging_stations.py`  | Gestionare stații, stația cea mai apropiată/optimă, planificare lanțuri multi-hop |
| `no_fly_zone_service.py`| Cache NFZ, celule blocate pe rute, gestionare expirare zone |
| `email_service.py`      | Șabloane HTML email pentru coduri de confirmare, confirmare comandă, resetare parolă |
| `bootstrap_service.py`  | Inițializare la pornire: seed utilizatori/drone/stații/NFZ, reparare entități blocate, pornire servicii de fundal |
| `demo_scenarios.py`     | 7 scenarii demo predefinite pentru demonstrație              |
| `audit_service.py`      | Înregistrare jurnal audit pentru toate acțiunile din sistem  |
| `alert_service.py`      | Creare alerte, deduplicare, gestionare ciclului de viață     |

---

## Scenarii Demo

Platforma include 7 scenarii predefinite, accesibile din dashboard-ul Dispecerului prin **Panoul de Scenarii**:

| # | Scenariu                      | Descriere                                                        |
| - | ----------------------------- | ---------------------------------------------------------------- |
| 1 | **Vreme Nefavorabilă**        | Forțează o furtună în zona Brașov (90s). Drona este oprită în zbor. |
| 2 | **Conflict Zonă Restricționată** | Creează un NFZ temporar pe ruta Cluj→Sibiu. Ruta ocolește automat. |
| 3 | **Baterie Scăzută**           | Pornește o dronă cu 8% baterie. Redirecționare automată la stația de încărcare. |
| 4 | **Reatribuire Automată**      | Simulează o defecțiune a motorului în zbor. Livrarea este reatribuită automat. |
| 5 | **Livrare Medicală Urgentă**  | Livrare de urgență insulină Suceava→Iași. Alocare prioritizată.   |
| 6 | **Test de Stres Flotă**       | Lansează 6 livrări simultane pe teritoriul României.              |
| 7 | **Furtună Națională**         | Setează furtună în toate zonele timp de 30s. Toate dronele sunt oprite simultan. |

Folosește **Resetare Flotă** pentru a readuce toate dronele la starea implicită între scenarii.

---

## Testare

### Teste Backend (pytest)

```bash
# Rularea tuturor testelor backend
pytest tests/ -v

# Rularea unui fișier specific de teste
pytest tests/test_deliveries.py -v

# Rulare cu acoperire de cod
pytest tests/ --cov=backend
```

Testele rulează pe o **bază de date SQLite in-memory** (configurată automat prin variabila de mediu `TESTING=1` în `conftest.py`).

Acoperirea testelor include:
- Autentificare (login, înregistrare, reîmprospătare JWT, resetare parolă)
- Autorizare (control acces pe baza rolurilor)
- Ciclul de viață al livrărilor (creare, alocare, anulare, confirmare, reatribuire)
- Gestionare drone (CRUD, schimbări de status, mentenanță)
- Ciclul de viață al misiunilor
- Rutare și pathfinding
- Meteo, zone restricționate și stații de încărcare

### Teste Frontend (Jest)

```bash
cd frontend
npm test
```

Teste de componente disponibile pentru:
- `CustomerDashboard`
- `DispatcherDashboard`
- `DeliveryTracker`
- `DeliveryHistory`
- `DeliveryDiagnostics`

---

## Limitări Cunoscute (Scop Academic)

Fiind un proiect de licență orientat spre dezvoltare software și arhitectură de sistem, există următoarele limitări asumate:

1. **Modelul Aerodinamic:** Simularea zborului este una cinematică (deplasare 2D liniară pe grilă). Nu include factori aerodinamici complecși precum fizica portanței, rezistența aerului (drag) sau curenții de aer 3D.
2. **Altitudine și Coliziuni:** Altitudinea nu este simulată. Toate dronele sunt considerate a zbura la o altitudine unică, neexistând un sistem de evitare a coliziunilor inter-drone (două drone pot intersecta aceeași coordonată).
3. **Dovada Livrării (PoD):** Modulul de depunere simulează semnătura și fotografia printr-un simplu URL demonstrativ (nu există procesare de imagini sau desen digital implementat).
4. **Integrare Hardware:** Aplicația rulează exclusiv în modul simulator software și nu expune, în acest moment, conectori MAVLink / PX4 pentru a prelua controlul unei drone fizice reale.

### Dezvoltări Viitoare

Pentru a duce proiectul din stadiul de simulare academică într-un produs pre-producție, următoarele direcții pot fi explorate:
- **Control Trafic Aerian (ATC):** Implementarea unui algoritm predictiv de evitare a coliziunilor în aer.
- **Protocol MAVLink:** Traducerea waypoints-urilor generate de algoritmul A* în comenzi MAVLink pentru controlul unor drone reale.
- **Navigație 3D:** Trecerea de la grilă 2D la navigație volumetrică (3D) folosind modele digitale de elevație (DEM).
- **Aplicație Mobilă:** Dezvoltarea unei interfețe mobile native pentru clienți (notificări push, semnare direct pe ecran pentru PoD).

---

## Documentație Suplimentară

| Document                                         | Descriere                              |
| ------------------------------------------------ | -------------------------------------- |
| [`docs/AUTH_GUIDE.md`](docs/AUTH_GUIDE.md)        | Detalii sistem de autentificare        |
| [`docs/DELIVERY_API.md`](docs/DELIVERY_API.md)    | Referință API livrări                  |
| [`docs/DELIVERY_USAGE_GUIDE.md`](docs/DELIVERY_USAGE_GUIDE.md) | Ghid utilizare livrări end-to-end |
| [`docs/FRONTEND_DELIVERY_GUIDE.md`](docs/FRONTEND_DELIVERY_GUIDE.md) | Ghid flux livrări frontend |

---

## Licență

Proiect de lucrare de licență — Universitatea Transilvania din Brașov.

---

<p align="center">
  Construit cu pasiune folosind FastAPI + React
</p>
