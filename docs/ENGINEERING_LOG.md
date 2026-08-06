# Cruddur — Engineering Log

**What this is:** a durable record of how this app actually works, what's been built, what's
broken, and why. It lives in the repo so it survives when a chat session dies.

**If you are an AI assistant picking this project up:** read this file first, then run
`git log --oneline -15` and `git status` to see anything that happened after the last update
below. Fabian is learning cloud engineering as a career change — he is not a developer yet.
He reads code well when it's explained, prefers to be pointed at specific files and line
numbers, and wants to understand *why* something is broken before seeing the fix. He makes
small edits himself; larger changes should be written for him, with the interesting parts
commented. Propose a plan before sweeping changes.

**Last updated:** 2026-08-05 — **the app is fully deployed on AWS.**

---

## 1. Current state

The app runs locally in Docker Compose and works end to end for a signed-in user:
home feed, profile page, replies, and direct messages all persist to Postgres.

**Authentication is real.** As of 2026-07-12 there is no hardcoded user anywhere in the
request path. The signed-in user is derived from a cryptographically verified Cognito JWT
and looked up in our own `users` table. (Older notes and handoff prompts claim `app.py`
hardcodes the handle `favyan` — that is **out of date**. It was fixed in `54d0107` and
completed in `d9fc32b` / `904b321` / `598d451`.)

### Containers

| Service | Port | Notes |
|---|---|---|
| `backend-flask` | 4567 | Flask, Python 3.10. **Does not hot-reload — must be restarted.** |
| `frontend-react-js` | 3000 | React 18, CRA. Hot-reloads on save. |
| `db` | 5432 | Postgres 13. **No longer the app's database** — kept as a psql client and for local-mode fallback. |
| `dynamodb-local` | 8000 | Present, not yet used. |
| `xray-daemon` | 2000 | AWS X-Ray tracing. Picks up new routes automatically. |

### Commands worth memorising

```bash
docker compose up                       # start the stack
docker compose ps                       # what's running
docker compose restart backend-flask    # ← reload Python changes. The one to remember.
docker compose logs --tail=40 backend-flask
docker compose logs --tail=40 frontend-react-js
docker compose exec db psql -U postgres -d cruddur -c "SELECT handle, cognito_user_id FROM users;"
```

The frontend reloads itself; the backend does not. Most "my change didn't do anything"
moments are a missing `docker compose restart backend-flask`.

---

## 2. How authentication actually works

This is the most important thing in the codebase to understand, and it's the closest thing
here to real cloud engineering — IAM roles, API Gateway authorizers and service-to-service
auth are all this same idea in AWS costume.

### The chain, end to end

1. **Sign in.** `SigninPage.js` calls Amplify's `signIn()`. Amplify stores the session
   (access token + refresh token) internally, in browser localStorage under
   `CognitoIdentityServiceProvider.*` keys. **We deliberately do not copy the token out.**
2. **Any API call.** The caller asks `getAccessToken()` (`src/lib/auth.js`) for a token
   *at the moment of the request*. That calls Amplify's `fetchAuthSession()`, which returns
   the cached token if it's still valid, or silently uses the refresh token to mint a new one
   if it has expired.
3. **The request** goes out with `Authorization: Bearer <token>`.
4. **The backend verifies it.** `app.py` → `get_cognito_user_id()` → `cognito_jwt_token.verify()`
   checks the token's *signature* against Cognito's public keys. If it's forged or expired,
   this raises `TokenVerifyError` and the route returns **401**.
5. **Only after verifying** does the backend read the `sub` claim — Cognito's permanent unique
   id for that account.
6. **Look up who that is to us.** `services/show_me.py` (`ShowMe.run`) selects the row from
   `users` where `cognito_user_id = sub`, returning `uuid`, `display_name`, `handle`.
7. **The frontend receives its own identity** from `/api/users/me` and renders the nav,
   profile link, etc. from it.

The key idea: identity is **derived**, never **asserted**. The client never gets to say
"I am favyan" — it presents a token, and the backend works out who that is.

### Why we don't cache the token (the bug that ate three sessions)

`SigninPage` used to do this:

```js
localStorage.setItem("access_token", session.tokens.accessToken.toString());  // DON'T
```

That takes a *photocopy* of the token. Cognito access tokens live about **one hour**. The
photocopy doesn't expire — it just silently becomes **wrong**. So an hour after signing in,
every request would send a dead token and get 401s.

It was worse than a plain 401, because of a trap: the nav's Profile, Crud and **Sign Out**
buttons all live inside `if (props.user)` in `DesktopNavigation.js`. When the token died,
`user` became `null`, so the app hid the sign-out button — *you could not sign out to fix
being signed out.* The escape hatch was typing `localStorage.clear()` into the DevTools
console.

Fixed 2026-07-12. Nothing snapshots the token any more; every request asks Amplify fresh.

### The sign-out trap (also fixed 2026-07-12)

Related, and worth understanding as a *design* lesson rather than a bug: every signed-in
control — Profile, Crud, and the **Sign Out** button inside `ProfileInfo` — lived in a single
`if (props.user)` block in `DesktopNavigation.js`, with **no `else`**. So when a session died,
the app hid the exit. You could not sign out of a broken sign-in.

The nav now renders a **Sign In** link in the `else` branch. `SigninPage` also calls
`signOut()` before `signIn()`, because Amplify keeps stale credentials in localStorage after a
refresh token expires, and `signIn()` throws `UserAlreadyAuthenticatedException` in that state
— which would have stranded you on the sign-in page instead.

**The general lesson:** whenever UI is gated on a condition, ask what the *other* branch shows.
An `if` with no `else` around auth state is how users get locked out of their own recovery path.

### `src/lib/auth.js` — the only file that talks to Cognito or `/api/users/*`

- `getAccessToken()` — a currently-valid **access** token, or `null`. Auto-refreshes.
- `getIdToken()` — a currently-valid **ID** token, or `null`. Also auto-refreshes. Needed only
  for provisioning, because it's the only token carrying `email` / `name` / `cognito:username`.
- `fetchCurrentUser()` — calls `/api/users/me`, returns our DB row for the user, or `null`.
  On a **404** it provisions the row instead of giving up (see §5). Used by all five pages'
  `checkAuth()`.
- `provisionCurrentUser()` — private. Posts the ID token to `/api/users/provision`.

`/api/users/me` and `/api/users/provision` are each referenced in exactly **one place** in the
frontend. If you add a page that needs to know who's signed in, call `fetchCurrentUser()` —
don't re-implement the fetch.

---

## 3. Reading errors — a triage guide

When `/api/users/me` (or any authed route) misbehaves, the status code tells you *which layer*
failed. Check it in DevTools → Network before touching any code.

| Status | Meaning | Where to look |
|---|---|---|
| **401** | Token missing, forged, or expired. | Request Headers — is `Authorization` present? `Bearer null` means `getAccessToken()` returned null, i.e. Amplify doesn't think you're signed in. |
| **404** | Token was *valid*, but no `users` row matches its `sub`. | The DB, not the code. `SELECT handle, cognito_user_id FROM users;` — your row needs a real `cognito_user_id`, not `MOCK`. |
| **500** | The route registered but the Python blew up. | `docker compose logs --tail=40 backend-flask` |
| **404 from Flask itself** (HTML, not JSON) | The route never registered. | Did you restart the backend? |
| **CORS error + `net::ERR_FAILED` on EVERY endpoint** | The backend isn't answering at all. The browser reports missing CORS headers because a dead server sends no headers — CORS is the symptom, not the disease. | `docker compose ps` and the backend logs. |

A **401 from `curl` with no token is the correct answer** — it means the route is guarding
itself. Don't mistake it for a failure.

### Reading webpack output

`docker compose logs frontend-react-js` prints a wall of yellow. Jump straight to the last
line:

- `webpack compiled with N warnings` → **fine.** Warnings are style complaints.
- `Failed to compile` → **broken.** Read the error above it.
- `Module not found: Can't resolve '...'` → a bad import path.

Warnings can still be *informative*: `'Cookies' is defined but never used` was what revealed
four pages of abandoned cookie-based auth.

---

## 4. Database notes

`users` table, as of the last check:

| handle | cognito_user_id |
|---|---|
| `andrewbrown` | `MOCK` |
| `hugol` | `MOCK` |
| `shark` | `MOCK` |
| `favyan` | *(real Cognito sub)* |

The three `MOCK` rows are seed data so message threads have someone to talk to. Nobody can
sign in as them — no real Cognito account maps to `MOCK`. That's fine and intentional for now.

Real users (`favyan`, plus anyone who signs up) have a genuine Cognito `sub` here. New rows
are created automatically on first sign-in — see §5.

A **404** from `/api/users/me` is no longer an error state: it's the normal condition of a
brand-new account, and the frontend answers it by provisioning. If you rebuild the Cognito
user pool, every `sub` changes, and existing rows will stop matching.

---

## 4b. RDS (as of 2026-07-18, the real database)

The app's Postgres now lives in **RDS, us-east-1** (same region as Cognito — always check the
region picker before creating anything; the console creates resources in whatever region it
happens to be showing). Instance: free-tier micro, public access ON but the security group
allows port 5432 **only from the home IP (`/32`)**. Public access is a temporary compromise
until Fargate exists in the VPC; then it goes private.

- Connection string lives in `.env` as `PROD_CONNECTION_URL`; docker-compose passes it via
  `${PROD_CONNECTION_URL}`. The DB password ends in `#`, which must be written `%23` inside
  the URL (a raw `#` ends the URL and silently swallows the hostname).
- **Local ↔ prod switch** = which `CONNECTION_URL` line is commented in docker-compose.yml.
- psql against RDS (the local db container is the client):
  ```bash
  docker compose exec db psql "$PROD_CONNECTION_URL"   # or paste the URL
  ```
- Schema/seed were loaded by piping the .sql files through the container:
  `docker compose exec -T db psql "<url>" < backend-flask/db/schema.sql`

### Diagnostics learned the hard way

- Compose warning **`The "PROD_CONNECTION_URL" variable is not set. Defaulting to a blank
  string`** at the top of any compose command = the `.env` line is missing/typo'd/unsaved.
  With a blank URL, psycopg tries the local Unix socket and the logs fill with
  `connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed`.
- **`restart` is not enough after changing environment config.** `docker compose restart`
  reuses the container with its old env baked in. `docker compose up -d` re-creates it —
  look for the word `Recreated` in the output.
- Connection test outcomes: version string = in; ~30s hang then timeout = security group;
  instant "password authentication failed" = network fine, password wrong; "database X does
  not exist" = connected, but the initial-database-name step was skipped (`CREATE DATABASE`
  from the `/postgres` default DB fixes it).

---

## 4c. ECS Fargate — in progress (2026-07-28)

Backend image lives in ECR (`backend-flask:latest`, built with `--platform linux/amd64`
because an Apple Silicon Mac builds ARM images by default and Fargate here runs x86 —
the artifact must match the machine that runs it, same lesson as the Lambda psycopg2).

Built so far:

- **Cluster `cruddur`** — the named space tasks run in; with Fargate it's mostly a label.
  First creation failed with "unable to assume the service linked role": ECS's own IAM
  role (`AWSServiceRoleForECS`) didn't exist yet. Retrying created it. Lesson: AWS
  *services* need roles too, not just users.
- **Task definition `backend-flask:1`** — the recipe: which image, 0.25 vCPU / 512 MB,
  OS/arch Linux/X86_64 (must match the image build platform), port 4567, all env vars
  (RDS URL with `%23`, Cognito IDs, Honeycomb key — the app refuses to boot without it),
  CloudWatch logging to `/ecs/backend-flask`. Revisions are immutable — edits create `:2`.
  Deliberately NOT included: AWS access keys (containers get credentials from IAM roles,
  never from env vars) and the X-Ray daemon address (no daemon in the cloud yet).
  The **task execution role** (auto-created) is *ECS's* permission to pull the ECR image
  and write logs — distinct from the (empty) task role, which would be *the app's* AWS
  permissions.
- **Security groups** — the chain of trust, each arrow one rule:
  - `cruddur-alb-sg`: HTTP 80 from home IP only (widen when the app goes public)
  - `cruddur-srv-sg`: TCP 4567, source = `cruddur-alb-sg` — the source is a *security
    group*, not an IP, because container IPs churn; "anyone wearing the ALB's badge"
    survives every redeploy
  - `cruddur-db-sg`: added 5432 from `cruddur-srv-sg` as a SECOND rule (AWS refuses to
    convert an IP-based rule to an SG-based one in place — add, don't edit). The home-IP
    rule stays for psql access. One rule per caller, like a guest list.

**2026-08-04 — ALB, target group and service created.**

- **Target group `cruddur-backend-tg`** — type **IP addresses** (Fargate tasks aren't
  EC2 instances; each task gets its own network interface), HTTP 4567, health check
  `/api/health-check`. Left empty on creation — the ECS service registers task IPs
  automatically; never register container IPs by hand.
- **ALB `cruddur-alb`** — internet-facing, `cruddur-alb-sg`, listener HTTP 80 →
  `cruddur-backend-tg`.
- **Service `backend-flask`** — desired 1 task, `cruddur-srv-sg`, **public IP ON**
  (without it the task can't reach ECR to pull the image in a public subnet — the
  alternative is private subnets + NAT at ~$32/mo).

### Bug found: AZ mismatch (the "Unused" target)

First deployment showed the target as **Unused: "Target is in an Availability Zone
that is not enabled for the load balancer."** Cause: the ALB was created with only two
subnets, but the service was allowed to launch tasks in ALL default subnets — so a task
landing in a third AZ was invisible to the ALB. Two resources, each fine alone,
disagreeing about geography. Fix: ALB → Network mapping → enable every AZ.
Rule of thumb: **the ALB's subnets must be a superset of the service's subnets.**

Target-state vocabulary: `Draining` = polite retirement (finish requests, deregister);
`Unused` = ALB can't/won't route to it (check AZ coverage); `initial` = health checks
in progress; `unhealthy` = checks failing (go read `/ecs/backend-flask` logs).

### Cost note — this tier BILLS while it exists (no free tier)

ALB ≈ $0.60/day, one running Fargate task ≈ $0.30/day. Between sessions: scale the
service to **Desired tasks: 0** (config survives, billing stops); the ALB either stays
(cheap-ish) or gets deleted and rebuilt. RDS remains free-tier.

**Next:** confirm target healthy → hit `http://<ALB-DNS>/api/health-check` from a
browser — first public request to the backend. Then S3 + CloudFront for the frontend.

---

## 4d. S3 + CloudFront — deployed (2026-08-05)

The frontend is static files in a **private** S3 bucket (`cruddur-frontend-favyanl`),
served by CloudFront (Free plan). CloudFront got bucket access via an origin access
control the wizard configured automatically; nobody reaches the bucket directly.

### The one-distribution / two-origin pattern (why there's no CORS anymore)

CloudFront serves HTTPS; the ALB only speaks HTTP; browsers block an HTTPS page from
calling an HTTP API ("mixed content"). Instead of buying a domain + certificate for
the ALB, CloudFront routes by path:

- default behavior → S3 (the React files)
- `/api/*` behavior → the ALB origin (HTTP-only is fine server-to-server),
  **CachingDisabled** (never cache API responses — caches are shared, feeds are
  personal), all HTTP methods enabled (the default GET-only blocks POSTs)

The build sets `REACT_APP_BACKEND_URL=""` so API calls are *relative* — same origin
as the page. One URL for everything; CORS no longer applies.

### Details that will bite if forgotten

- **Default root object** `index.html`, and **Error pages**: 403/404 → `/index.html`
  with response code 200. React Router invents routes client-side; without the
  fallback, refreshing `/messages` asks S3 for a file that doesn't exist.
- `cruddur-alb-sg` inbound is now **0.0.0.0/0:80** — the ALB went public when the
  site did. (Hardening wishlist: restrict to CloudFront's managed prefix list.)
- The production build runs **inside the frontend container** (the Mac has no Node):
  `docker compose exec frontend-react-js sh -c '<REACT_APP vars> npm run build'`
  then `docker cp` the `build/` folder out. Build values are frozen in at build time.
- `frontend-react-js/build/` is **gitignored** — generated artifacts don't get committed.

### How to ship a frontend change (the redeploy recipe)

1. Rebuild (command above, same env vars)
2. `aws s3 sync ./frontend-react-js/build s3://cruddur-frontend-favyanl`
3. **Invalidate the CloudFront cache** or users keep getting the old files from edge
   caches: CloudFront → distribution → Invalidations → Create → path `/*`
   (or: `aws cloudfront create-invalidation --distribution-id <ID> --paths "/*"`)

### Bug: the SPA fallback ate the API's 404 (found by the first stranger, fixed 2026-08-05)

First real user could sign up and verify but never appeared signed in. Diagnosis chain:
the DB showed **no row for them** (provisioning never ran) → provisioning is triggered by
`/api/users/me` returning **404** → CloudFront's custom error response ("404 → serve
`/index.html` as 200") applies to the WHOLE distribution, `/api/*` included — so the
frontend received the homepage HTML with a 200 instead of the 404, `res.json()` threw,
and the provision path never fired. Confirmed by fetching a nonsense `/api/` path and
getting the React shell back.

**Fix: delete the 404 custom error response; keep only the 403 one.** Deep-link refreshes
still work because S3-behind-OAC answers *403* (not 404) for missing files — the policy
grants only GetObject, so S3 won't even confirm a file's absence. The 403 rule alone
carries the SPA fallback.

Lessons: custom error responses are distribution-wide, not per-behavior — never let an
error-masking rule cover an API path whose status codes carry meaning. And existing users
worked fine throughout (their flow is all 200s), which is why the bug only bit newcomers.

Stranger-test UX findings, wishlist: after email confirmation, redirect to sign-in with
a message (users assume verified = signed in); the reply popup has NO close button
(`popup_heading` is empty — the only escape is refreshing); signed-out users can open
the reply form and submit into a silent 401; timestamps render as negative minutes
(UTC stored, local assumed — timezone handling needed).

### What "deployed" means as of today

Browser → CloudFront (HTTPS) → S3 for the app, ALB → Fargate → RDS for the API.
Cognito for identity. The laptop is no longer in the serving path at all.
Running cost ≈ $1/day (ALB + one Fargate task); RDS free tier; S3/CloudFront pennies.

---

## 5. Sign-up, and how a user gets into the database

Sign-up worked for the first time on 2026-07-12. It had never worked before, and the reason
is a good lesson in stacked failures — **four separate bugs, each one hiding the next.**

### The flow now

1. `SignupPage` calls Amplify `signUp()`. **The Cognito username is the handle, not the email.**
   This pool has email as an *alias*, and Cognito forbids an email-shaped username in that
   configuration (`Username cannot be of email format`). You still *sign in* with your email —
   that is what the alias is for.
2. Cognito emails a verification code.
3. `ConfirmationPage` calls `confirmSignUp({ username: <handle>, confirmationCode })`.
   **It must address the account by handle, not email:** alias attributes do not work until
   *after* an account is confirmed, and an unconfirmed account is exactly what this is.
4. User signs in. `fetchCurrentUser()` calls `/api/users/me` → **404**, because Cognito knows
   them but Postgres doesn't.
5. The 404 triggers `POST /api/users/provision`, sending the **ID token**. The backend verifies
   it, reads `sub` / `email` / `name` / `cognito:username` from the *verified claims*, and
   INSERTs the row. The browser never gets to assert its own handle.

### Access token vs ID token — the distinction that made this possible

Cognito issues two tokens and they are **not** interchangeable:

- **Access token** — "is this request allowed?" Carries `sub`, and little else.
- **ID token** — "who is this?" Carries `sub` **plus** `email`, `name`, `preferred_username`,
  `cognito:username`.

Every ordinary API call sends the access token, because `sub` is all the backend needs to look
you up. Provisioning is the one place that needs the attributes, so it sends the ID token.
`get_cognito_claims(expected_token_use)` in `app.py` pins down which one a route will accept —
without that check the verifier would take either, since it validates the *signature* but
never asks what **kind** of token it is.

### The four bugs, and why each hid the next

1. `SignupPage` passed attributes as `attributes: {...}` — the **Amplify v5** shape. v6 wants
   `options: { userAttributes: {...} }`, and **silently ignores the old key.** So accounts were
   created with no email at all, and no verification mail could ever be sent.
2. The Username input read `value={username}` but wrote with `setName()` — bound to one state,
   updated by another. It could not change as you typed.
3. `ConfirmationPage` never called Cognito. It compared cookies (`user.confirmation_code`) that
   nothing ever set. **So `confirmSignUp()` was never invoked...**
4. ...**which meant the Post Confirmation Lambda trigger never fired** — and so nobody ever saw
   that it was broken. See below.

You could not see bug 4 until bug 3 was fixed. That is why "it never worked and I don't know
why" was an honest description of the situation.

### The Lambda (`aws/json/lambdas/cruddur-post-confirmation.py`)

It **was attached to the user pool all along**, and it crashed on import:

```
Unable to import module 'lambda_function': No module named 'psycopg2._psycopg'
```

`psycopg2` is a **C extension** — `_psycopg` is a compiled binary. A build made on macOS will
not load on Lambda's Amazon Linux. It needs `aws-psycopg2` or a prebuilt layer.

Two things worth carrying forward:

- **A failing Lambda trigger does not degrade quietly — it sits in the critical path.**
  Cognito reports the trigger's error straight back to the client.
- **"Pre" and "Post" are load-bearing words.** Post Confirmation runs *after* Cognito has
  already flipped the account to CONFIRMED. So the account got confirmed anyway, and the error
  arrived afterwards — which is why an account could end up CONFIRMED even though the UI showed
  a failure. A **Pre** Sign-up trigger failing would genuinely have blocked the operation.

**The trigger is now detached from the pool** (the Lambda function still exists in AWS). The
code has since been fixed — packaging notes, the `finally: if conn` `NameError`, and an
idempotent INSERT. Do not re-attach it until the DB is on RDS and psycopg2 is packaged for the
Lambda runtime, or sign-up breaks for everyone again.

### Password recovery (works as of 2026-07-13)

`RecoverPage.js` implements Cognito's two-step reset: `resetPassword({ username })` emails a
code, `confirmResetPassword({ username, confirmationCode, newPassword })` completes it. Two
details worth remembering:

- **Email works here, unlike at sign-up confirmation.** Alias attributes only resolve for
  *confirmed* accounts — and anyone recovering a password is confirmed by definition. So the
  form accepts email or handle.
- The `username` state deliberately survives from step 1 to step 2: `confirmResetPassword`
  must address the same identifier the code was requested for.

### Cognito's built-in email is rate-limited

~50 messages/day across the whole pool, and it sends from an untrusted domain, so codes land in
spam constantly. Wiring the pool to **SES** is the real fix and is still outstanding.

### The admin back door

If someone gets stuck unconfirmed:

```bash
aws cognito-idp admin-confirm-sign-up --user-pool-id <POOL_ID> --username <handle>
aws cognito-idp admin-delete-user     --user-pool-id <POOL_ID> --username <handle>
```

**Do not use `aws cognito-idp update-user-pool` to change pool settings.** It *replaces* the
configuration rather than patching it — anything you don't re-specify is silently reset to
default. Use the console, which does a read-modify-write for you.

---

## 6. Open problems

Roughly in priority order.

1. **`handle` has no UNIQUE constraint in Postgres.** Cognito enforces username uniqueness, so
   two people can't take the same handle *via sign-up* — but nothing at the database level
   stops it. A `UNIQUE` constraint on `users.handle` would make the guarantee real rather than
   incidental. (Related: no FK constraint on `activities.reply_to_activity_uuid`, which once
   allowed orphan replies pointing at mock activities.)
2. **`App.js` has a second, competing idea of the current user.** It calls Amplify's
   `getCurrentUser()` directly to gate the `/` route, while every page below it uses
   `fetchCurrentUser()`. Two sources of truth. Should be unified.
3. **Cognito's built-in email should be replaced with SES.** ~50/day, lands in spam.
4. **The "More" button in the sidebar does nothing.** Either give it a purpose or remove it.
5. **The notifications page serves mock data** (`notifications_activities.py`), and replying
   to a mock activity writes orphan rows. Park or implement.
6. **AWS deployment** hasn't started. The eventual target is ECS Fargate + RDS + S3/CloudFront.

*(Resolved 2026-07-13: forgot-password — see §5.)*

---

## 7. Gotchas already paid for

Things that cost real time once. Don't rediscover them.

- **`/@:handle` does not work in react-router-dom 6.4.3.** A literal `@` before a dynamic
  segment doesn't match. The workaround throughout this codebase is a route of `/:handle`
  plus normalisation — strip a leading `@` if present:
  ```js
  const cleanHandle = rawHandle.startsWith('@') ? rawHandle.slice(1) : rawHandle;
  ```
- **Secrets go in `.env`, which is gitignored.** The Honeycomb API key lives there.
  Never commit a secret, even in an example.
- **The backend does not hot-reload.** `docker compose restart backend-flask`.
- **Amplify v6 changed everything.** Tokens come from `fetchAuthSession()`, not from the
  `signIn()` result. Most tutorials online are v5 and will mislead you.

---

## 8. Commit history worth knowing

```
598d451  Resolve current user via shared fetchCurrentUser() on every page
904b321  Fetch identity from /api/users/me and stop caching the access token
d9fc32b  Add /api/users/me endpoint to resolve signed-in user from JWT
5f71d66  Wire up ReplyForm on profile page to fix crash on reply
54d0107  Derive user identity from verified Cognito JWT instead of hardcoded handle
10ad01b  Fix Amplify v6 token storage and send auth header on API calls
d711eb5  Disable submit buttons while POST is in flight to prevent duplicates
393b5b9  Move Honeycomb secrets to .env; add .env to gitignore
2d6d1c1  Implement real DB-backed messages and complete profile/reply fixes
5602b5a  Implement real DB persistence for activities, fix home feed SQL
```

Together, `d9fc32b` → `598d451` are the arc that replaced all the fake identity scaffolding
with real Cognito-derived identity.

---

## 9. Conventions

- Commit in **logical groups** with descriptive messages explaining *why*, not just what.
- Reusable patterns to keep using:

  **Guard against double-submit** (all three forms use this):
  ```js
  const [submitting, setSubmitting] = React.useState(false);
  const onsubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;        // ignore extra clicks
    setSubmitting(true);
    try {
      // ...fetch...
    } finally {
      setSubmitting(false);        // ALWAYS re-enable, even if the fetch threw
    }
  };
  ```
  The `finally` is what stops a failed request leaving the button disabled forever.

  **Any authenticated fetch:**
  ```js
  const access_token = await getAccessToken();   // fresh every time — never cached
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${access_token}` }
  });
  ```