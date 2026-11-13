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

## Community voice channels
- Voice channels are separate from text channels.
- Audio uses browser WebRTC; Supabase Realtime Broadcast and Presence handle signaling and participant state.
- TURN credentials are read only by the `voice-ice-servers` Edge Function from Supabase Edge Function secrets.
- Configure `METERED_TURN_USERNAME` and `METERED_TURN_CREDENTIAL` in Supabase → Edge Functions → Secrets.
- Apply `database/voice-channels.sql` to set up voice channels and private Realtime authorization.
- In Supabase → Realtime → Settings, turn off **Allow public access** so private-channel RLS authorization is enforced.
- Microphone access requires HTTPS and the user's browser permission. Headphones are recommended to reduce echo.

Never commit TURN credentials, Metered account secret keys, or Supabase secret/service-role keys.
