# My Garage 🚗

A personal car management app for enthusiasts. Track your builds, mods, maintenance, parts wishlist, todos, and issues — all stored locally in your browser.

**Live demo:** https://drkchng.github.io/car-garage/

## Features

- **Multiple cars** — add as many builds as you want
- **Photo gallery** — upload images, set a cover photo
- **Parts wishlist** — track parts with links and prices, mark as Wanted → Ordered → Installed
- **Mods log** — record modifications grouped by category with cost tracking
- **Maintenance log** — service history with next-due date and mileage reminders
- **To-Do list** — prioritized task list per car
- **Issues tracker** — log problems by severity, track resolution
- **Customizable themes** — 6 presets + custom accent color picker
- **100% local** — all data is stored in your browser (IndexedDB). Nothing is sent to a server.

## Using the Live App

Just visit **https://drkchng.github.io/car-garage/** — no account or install needed. Your data stays in your browser.

> **Note:** Data is stored locally in the browser you use. Clearing browser data will erase it. To move data between devices, use the Export/Import feature (coming soon).

## Running Locally

Requires [Node.js](https://nodejs.org/) v18 or later.

```bash
git clone https://github.com/drkchng/car-garage.git
cd car-garage
npm install
npm run dev
```

Then open http://localhost:5173 in your browser.

## Deploying Your Own Instance

### GitHub Pages (recommended — free, no server needed)

1. [Fork this repo](https://github.com/drkchng/car-garage/fork)
2. In your fork, go to **Settings → Pages**
3. Under **Build and deployment**, set Source to **GitHub Actions**
4. Push any change to `master` — the workflow will build and deploy automatically

Your app will be live at `https://<your-username>.github.io/car-garage/`

### Vercel / Netlify (one click)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/drkchng/car-garage)

For Netlify or any other static host: run `npm run build` and upload the `dist/` folder.

> If you deploy to a different path than `/car-garage/`, update the `base` field in `vite.config.js` to match.

## Tech Stack

- [React](https://react.dev/) + [Vite](https://vite.dev/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Zustand](https://zustand-demo.pmnd.rs/) — state management
- [localForage](https://localforage.github.io/localForage/) — IndexedDB persistence
- [React Router](https://reactrouter.com/)
- [Lucide React](https://lucide.dev/) — icons
- GitHub Actions + GitHub Pages — CI/CD
