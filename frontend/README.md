# DeliveryPro — Frontend

Interfața web React pentru platforma de livrări cu drone.

## Pornire

```bash
npm install
npm start
# Aplicație disponibilă la http://localhost:3000
```

Backend-ul trebuie să ruleze pe `http://127.0.0.1:8000` (sau setează `REACT_APP_API_URL`).

## Structură

```
src/
  components/   # Componente UI (Login, Dashboards, Map, etc.)
  context/      # AuthContext (autentificare globală)
  hooks/        # Custom hooks (WebSocket, toast, tracking)
  services/     # api.js — client Axios cu interceptori JWT
  assets/       # Iconuri
```

## Roluri și ecrane

| Rol        | Dashboard           | Pagini extra                   |
| ---------- | ------------------- | ------------------------------ |
| Customer   | CustomerDashboard   | Map                            |
| Dispatcher | DispatcherDashboard | Deliveries, Drones, Map        |
| Admin      | DispatcherDashboard | Deliveries, Drones, Users, Map |

## Variabile de mediu

| Variabilă           | Default                 | Descriere           |
| ------------------- | ----------------------- | ------------------- |
| `REACT_APP_API_URL` | `http://127.0.0.1:8000` | URL-ul backend-ului |

## Conturi demo

| Email                  | Parolă   | Rol        |
| ---------------------- | -------- | ---------- |
| admin@example.com      | Pass123! | admin      |
| dispatcher@example.com | Pass123! | dispatcher |
| customer@example.com   | Pass123! | customer   |
