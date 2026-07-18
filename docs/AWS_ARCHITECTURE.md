# Cruddur — Target AWS Architecture, Explained

**What this is:** a plain-language reference for every AWS component in the deployment plan —
what each one is, what job it does *here*, what it replaces from the local docker-compose
setup, and what it talks to. Companion to `ENGINEERING_LOG.md`.

**The one-sentence summary:** the browser talks to exactly two things — CloudFront (to get
the app) and the ALB (to use the API). Everything else sits behind those two doors.

---

## The mental model: passive vs active components

Before the component list, one distinction that answers a lot of "why isn't X connected
to Y" questions:

- **Active** components run code and *initiate* requests: the browser, the Flask container,
  the Lambda.
- **Passive** components never initiate anything. They answer when asked: S3, RDS, Cognito,
  CloudFront.

Arrows in an architecture diagram point *from* whoever picks up the phone *to* whoever
answers it. S3 has one arrow (from CloudFront) because only CloudFront ever asks it for
anything. That's not S3 being unimportant — it's S3 being a filing cabinet, not an employee.

---

## Component by component

### S3 (Simple Storage Service)
- **What it is:** file storage. Buckets hold files ("objects"); that is the whole product.
  No code runs in S3, ever.
- **Its job here:** holds the *built* React app — the static HTML/JS/CSS that
  `npm run build` produces.
- **Replaces locally:** the `frontend-react-js` dev-server container.
- **Why it connects to nothing but CloudFront:** two reasons.
  1. It's passive — it cannot call the backend or anything else. It waits to be read.
  2. In production, **React is not a running program on a server.** The "app" is a bundle
     of files. Once the browser downloads them, all the action — fetch calls, auth, state —
     happens *in the browser*. So the thing that talks to the ALB and Cognito is the
     browser, not S3. S3's only customer is CloudFront, fetching files to cache them.
- **Cost:** cents. Storage and requests at this scale are effectively free.

### CloudFront
- **What it is:** a CDN — *Content Delivery Network*. The idea: instead of every visitor
  fetching your files from one bucket in one region (a user in Tokyo waiting on a round
  trip to Virginia), AWS keeps **copies of your files on hundreds of cache servers around
  the world** ("edge locations"), and each visitor is served by the one nearest to them.
  First visitor in a city pays the slow trip to S3; everyone after gets the cached copy in
  milliseconds. You upload once; the network handles distribution. Same idea Netflix and
  every big site use — CloudFront is just AWS's rentable version of it.
- **Its job here:** serves the S3 files fast, gives us HTTPS for free, and is the URL users
  actually visit.
- **Why not serve straight from S3?** You can, but plain S3 website hosting has no HTTPS on
  custom domains and no caching edge. CloudFront in front of an S3 bucket is *the* standard
  pattern.
- **Replaces locally:** the `localhost:3000` half of the equation.
- **Cost:** cents at this traffic level.

### ALB (Application Load Balancer)
- **What it is:** a stable HTTP(S) front door that spreads requests across backend copies.
- **Its job here:** the one fixed address for `/api/*`. Containers come and go (crash,
  redeploy, scale); the ALB address never changes. It also health-checks containers and
  stops sending traffic to dead ones.
- **Why we can use one at all:** the backend is stateless — any container can verify any
  JWT and serve any request. This is the direct payoff of the auth work.
- **Replaces locally:** typing `localhost:4567`.
- **Cost:** ~$16–20/month, *runs while it exists* regardless of traffic. One of the two
  main "forgot to turn it off" costs.

### ECS Fargate (Elastic Container Service, Fargate flavor)
- **What it is:** runs Docker containers without you managing any servers. ECS is the
  orchestrator ("run 2 copies of this image, restart them if they die"); Fargate is the
  serverless way to host them (AWS finds the machine; you never see it).
- **Its job here:** runs the `backend-flask` image — the same image, built the same way,
  that runs on the laptop. That's the point of containers: the artifact doesn't change,
  only where it runs.
- **Replaces locally:** `docker compose up backend-flask`.
- **Related piece — ECR (Elastic Container Registry):** the private Docker image library
  AWS pulls from. `docker push` to ECR is how code gets to Fargate. Replaces nothing local
  — it's the bridge between laptop and cloud.
- **Cost:** a small always-on task is roughly $10–15/month. The other main "turn it off"
  candidate.

### RDS (Relational Database Service)
- **What it is:** managed Postgres. AWS owns backups, patching, failover, disk.
- **Its job here:** the `cruddur` database — users, activities, messages. Same engine, same
  SQL, same psql access as the local container; only the hostname changes.
- **Replaces locally:** the `db` container and its Docker volume.
- **Who talks to it:** the Flask containers, and (eventually) the post-confirmation Lambda.
  Never the browser — the database lives in a private part of the network with no public
  door. This is a *feature*, and it's also exactly why the Lambda failed on a laptop
  database: databases should only be reachable from inside the network they live in.
- **Cost:** smallest instance ~$15–25/month. Can be *stopped* when not in use (auto-restarts
  after 7 days — a known gotcha).

### Cognito
- **What it is:** managed identity — user accounts, passwords, email verification, JWTs.
- **Its job here:** everything in `ENGINEERING_LOG.md` §2 and §5. Sign-up, sign-in, tokens.
- **Replaces locally:** nothing — it was always in the cloud. The laptop app has been
  calling the real Cognito all along, which is why auth needs zero changes on deploy day.
- **Who talks to it:** the *browser* (via Amplify) for sign-in/sign-up. The backend never
  calls Cognito at runtime — it only downloaded the public keys once at startup to verify
  token signatures offline. (This surprises people. It's also why the backend is fast.)
- **Cost:** free tier covers this project comfortably.

### Lambda (post-confirmation)
- **What it is:** run-a-function-on-an-event compute. No server, no container to manage;
  AWS runs the function when the trigger fires and bills per invocation.
- **Its job here:** when Cognito confirms a new account, INSERT the user's row in RDS.
  It's the event-driven twin of the `/api/users/provision` endpoint — same outcome,
  different trigger. (Currently detached; see the log §5 for the full saga. It returns
  when RDS exists and psycopg2 is packaged for Amazon Linux.)
- **Cost:** effectively free at this volume.

### The network itself: VPC, subnets, security groups
Not boxes on the diagram, but the floor the boxes stand on:
- **VPC** — your private slice of AWS's network. Everything above lives inside one.
- **Subnets** — rooms in that network. *Public* rooms (the ALB) are reachable from the
  internet; *private* rooms (RDS, ideally the containers) are not.
- **Security groups** — per-component firewalls, written as "who may knock on which port."
  E.g.: RDS accepts port 5432 *only from the backend's security group*. Most
  "it can't connect" problems in AWS are a security group saying no. Expect to meet them.

---

## Three walkthroughs

**Loading the app:** browser → CloudFront (`https://cruddur.example`) → cache hit? serve;
miss? fetch from S3, cache, serve. The browser now runs the React bundle locally.

**Posting a crud:** browser asks Amplify for a fresh access token → `POST /api/activities`
with `Authorization: Bearer …` → ALB → some Flask container → verifies signature with the
cached Cognito public keys → `INSERT` into RDS using the `sub` claim → 200 back up the
same chain. Cognito is not called. S3 and CloudFront are not involved at all.

**A new user signs up:** browser ↔ Cognito directly (Amplify): signUp → email code →
confirmSignUp → CONFIRMED → Cognito fires the post-confirmation Lambda → Lambda INSERTs
the user row in RDS. If the Lambda is detached, the fallback is the app's own
provision-on-404 path (log §5). Two roads to the same row.

---

## Why the build order is what it is

1. **Budget alarm + IAM** — before creating anything that bills.
2. **RDS** — because the *local* backend can point at it (`PROD_CONNECTION_URL` is already
   plumbed in `bin/db-connect`). Cloud database, trusted local app: one new variable.
3. **ECR + Fargate + ALB** — cloud backend against a database already known to work.
4. **S3 + CloudFront** — the frontend goes last because it needs a real API URL to be
   built against (`REACT_APP_BACKEND_URL` is baked in at build time — a production build
   is a *snapshot*, not a living process).
5. **Lambda revival** — needs RDS reachable from inside AWS, which now exists.

One variable changes per step. When something breaks — and something will — the suspect
list is short.

---

## Cost reality check

| Component | Rough monthly (always-on) | Can it idle cheap? |
|---|---|---|
| ALB | ~$16–20 | No — delete when not demoing |
| Fargate (1 small task) | ~$10–15 | Yes — scale service to 0 |
| RDS (smallest) | ~$15–25 | Stop it (restarts after 7 days) |
| S3 + CloudFront | ~$1 | Already cheap |
| Cognito, Lambda | $0 at this scale | — |

The learning pattern that keeps this near-free: **build it, prove it works, tear the
expensive parts down, keep the scripts that rebuild them.** Rebuilding from scripts isn't
wasted work — it's the whole skill (and the on-ramp to infrastructure-as-code).
