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

**Last updated:** 2026-07-13

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
| `db` | 5432 | Postgres 13. Database name: `cruddur`, user: `postgres`. |
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
