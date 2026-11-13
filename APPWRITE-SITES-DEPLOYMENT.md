# Deploying the frontend to Appwrite Sites

The application stays **plain HTML, CSS and JavaScript**. No framework was added.
Sites hosts the static build; `goc-api` serves the API.

## Build for Sites

```bash
GOC_API_BASE=https://<function>.appwrite.global/api npm run build
```

Output goes to `dist/`. That is the directory to deploy.

- The value must be absolute http(s), include the `/api` suffix, and have no
  trailing slash. Anything else **fails the build** immediately.
- The base is injected once, into `GOC.apiBase` in `js/api.js`. `js/api.js` loads
  before `js/free2027-api.js` and `js/free2027-ui.js` (verified against
  `index.html`), so every module reads the same value. No module hardcodes a host.
- The value is public by design: it is a URL, not a credential.

### Do not deploy these directories

| Directory | Why |
| --- | --- |
| `deploy/` | OneBit deployment bundle — different host model |
| repository root | Contains `server/`, `.env.example` and tooling |
| `functions/` | Server code and a proposed schema; never public |

`build/build.js` copies only the existing public asset list, so `dist/` contains
no `server/` or `functions/` directory. `test-migration-api-config.js` asserts this.

## Site settings

| Setting | Value |
| --- | --- |
| Framework preset | **Other / static** (not SSR, not a SPA fallback that rewrites `/api`) |
| Build command | `npm run build` |
| Output directory | `dist` |
| Install command | `npm ci` |
| Build variable | `GOC_API_BASE` only |
| Node version | Match the repo (`>=18`) |

The app is a hash/path-routed vanilla PWA served from `index.html`. Confirm the
Site's fallback rules do not intercept `/api` — API calls go to the **Function
origin**, not the Site, so no proxy rewrite is needed.

## CORS

The Function allow-lists exact origins. After the Site domain is generated, set
on the Function:

```
GOC_ALLOWED_ORIGINS=https://<generated-site-domain>
```

Do **not** add `gocacademy.live`, and do not use a wildcard. Requests from an
unapproved origin receive `403`. Preflight `OPTIONS` requests are answered for
approved origins only.

## PWA behaviour

`sw.js` pre-caches a fixed static asset list and never caches API responses, so
authenticated data is never stored in the service-worker cache on Sites. The
cache name (`goc-v206`) is unchanged; no service-worker edit was needed.

If a future change alters the asset list, bump the cache name as the existing
release process already does.

## Custom domain

**Leave DNS alone.** Use the generated Site domain for testing. Do not point
`gocacademy.live` at Appwrite, and do not retire or modify the OneBit deployment
as part of this work.

## Verify after deploying

1. `https://<site>/` loads the shell with unchanged layout and branding.
2. DevTools Network shows API calls going to the **Function** origin.
3. The Free Tutorial mode switch resolves (needs the `health` state reader).
4. Log in as each identity type separately; a student token must not open the
   console, and a Free Tutorial participant token must not open student routes.
5. Confirm no privileged string appears anywhere in the served JavaScript.
