# contract-hub-auth

A tiny Cloudflare Worker that makes **Sign in with GitHub** possible for the static Contract Hub app.
It exchanges GitHub's one-time OAuth `code` for an access token, which requires the OAuth App's client
secret, and that secret must not live in a static site. The Worker stores and logs nothing.

Endpoints: `POST /token` (code → token, PKCE-verified) and `POST /revoke` (used by *Sign out*).
Only origins listed in `ALLOWED_ORIGINS` get a response, and tokens are only issued for a `redirect_uri`
on the calling origin.

## Deploy

1. **Create a GitHub OAuth App**: GitHub → *Settings → Developer settings → OAuth Apps → New OAuth App*
   (or under your organization's settings, so the org owns it).
   - *Homepage URL*: where the app is hosted, e.g. `https://your-org.github.io/contract-hub/`
   - *Authorization callback URL*: the same URL. GitHub accepts sub-paths of it, but not other hosts.
     For local development, create a second OAuth App with `http://localhost:5173/`
     (an OAuth App has only one callback URL).
   - Generate a **client secret**.
2. **Configure** `wrangler.toml`: set `GITHUB_CLIENT_ID` and `ALLOWED_ORIGINS`.
3. **Deploy**:
   ```bash
   cd auth-worker
   npx wrangler login
   npx wrangler secret put GITHUB_CLIENT_SECRET   # paste the secret when asked
   npx wrangler deploy                            # prints https://contract-hub-auth.<you>.workers.dev
   ```
4. **Point the app at it**: set `VITE_GITHUB_CLIENT_ID` and `VITE_OAUTH_EXCHANGE_URL` (in `.env` locally, or
   the `OAUTH_CLIENT_ID` / `OAUTH_EXCHANGE_URL` repository variables for the GitHub Pages build).

To sign everyone out at once, reset the OAuth App's client secret (and `wrangler secret put` the new one),
or revoke all user tokens on the OAuth App's settings page.

If your organization has *OAuth App access restrictions* enabled, an org owner must approve the app before
members can use it on the org's repositories.
