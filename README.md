# NEXORA

NEXORA is a Turkish-first community platform built with HTML, CSS, JavaScript and Supabase.

## Current MVP
- Email/password authentication
- Public profile and username
- Public community discovery and membership
- Public feed, posts, comments and likes
- Responsive dark futuristic UI

## Setup
1. Create a Supabase project.
2. Apply the SQL schema from `database/schema.sql` (already applied to the connected NEXORA project).
3. Set the Supabase project URL and publishable key in `config.js`.
4. Enable GitHub Pages for the repository (Settings → Pages → GitHub Actions).

Only the Supabase publishable key belongs in the browser. Never put a Supabase secret/service-role key in this repository.

## Local preview
Serve the repository root with any static HTTP server. Opening `index.html` directly may block module/CDN requests in some browsers.
