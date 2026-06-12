# FilmSnap

FilmSnap is a modern web application for discovering, searching, and saving movies and TV shows. Built with Next.js and TypeScript, it leverages the TMDB API to provide a rich, interactive experience for film and TV enthusiasts. The app features authentication, watchlists, search, and responsive UI components.

## Features

- **Browse Movies & TV Shows:** Explore trending, popular, and top-rated content from TMDB.
- **Search:** Find movies and TV shows by title or keyword.
- **Authentication:** Secure login and registration system.
- **Watchlist:** Save your favorite movies and TV shows for later viewing.
- **Responsive UI:** Modern, mobile-friendly design using Tailwind CSS.
- **Error Handling:** Robust error boundaries and loading states.
- **API Integration:** Fetches data from TMDB and handles user sessions securely.

## Tech Stack

- **Framework:** Next.js (App Router)
- **Language:** TypeScript, JavaScript
- **Styling:** Tailwind CSS
- **API:** TMDB (The Movie Database)
- **Authentication:** Custom (with session management)
- **State Management:** React Context, custom hooks

## Project Structure

- `app/` — Main application pages and API routes
- `components/` — Reusable UI components (e.g., Header, MovieCard, MediaCarousel)
- `hooks/` — Custom React hooks (e.g., useDebounce, useWatchlist)
- `lib/` — Utility functions and API logic (e.g., tmdb.ts, authCooldown.ts)
- `public/` — Static assets
- `types/` — TypeScript type definitions

## Getting Started

### Prerequisites

- Node.js (v18+ recommended)
- pnpm (or npm/yarn)

### Installation

1. **Clone the repository:**
   ```sh
   git clone <repo-url>
   cd "FilmSnap"
   ```
2. **Install dependencies:**
   ```sh
   pnpm install
   # or
   npm install
   ```
3. **Set up environment variables:**

   - Copy `.env.example` to `.env` and fill in the required values (e.g., TMDB API key).

4. **Run the development server:**
   ```sh
   pnpm dev
   # or
   npm run dev
   ```
   The app will be available at [http://localhost:3000](http://localhost:3000).

## Scripts

- `dev` — Start the development server
- `build` — Build the application for production
- `start` — Start the production server
- `lint` — Run ESLint

## Environment Variables

- `TMDB_API_KEY` — Your TMDB API key
- Other variables as required for authentication/session (see `.env.example`)

## Folder Overview

- `app/` — Pages, API routes, and layouts
- `components/` — UI components
- `hooks/` — Custom hooks
- `lib/` — API and utility logic
- `public/` — Static files
- `types/` — TypeScript types

## Contributing

Contributions are welcome! Please open issues or submit pull requests for new features, bug fixes, or improvements.

## License

This project is licensed under the MIT License.

---

**FilmSnap** — Discover, search, and save your favorite movies and TV shows with ease.
