# RailFlow AI Frontend

## Run
```bash
npm install
npm run dev
```

Open the URL shown by Vite (normally http://localhost:5173).

## Backend connection
By default frontend calls `http://localhost:5000`.
If your backend runs elsewhere, create `.env`:
```env
VITE_API_URL=http://localhost:5000
```

## Backend APIs used
- GET /api/analytics/dashboard
- GET /api/network
- GET /api/trains
- GET /api/conflicts
- GET /api/recommendations
- POST /api/recommendations/generate
- GET /api/controller-decisions
- POST /api/controller-decisions
