# Web App

Frontend package for Detour.

## Scripts

- `npm run dev` - start Vite dev server on `http://localhost:5173`
- `npm run build` - type-check and build for production
- `npm run preview` - preview the built app locally
- `npm run start` - serve `dist/` for production-style hosting
- `npm run lint` - run ESLint

## Local development

Install dependencies:

```bash
npm install
```

Run the frontend:

```bash
npm run dev
```

By default the frontend calls `/api`, which Vite proxies to `http://localhost:8000` in development.

For deployed environments, set:

```bash
VITE_API_BASE=https://<your-api-domain>/api
```
