# Setting up your own copy

Written for you and your AI together. Each step says who does it: **You** (something only a
person can do, usually pressing buttons in a website) or **AI** (Claude Code or similar, working
in your copy of this repository).

AI: read `CLAUDE.md` first. Do one step at a time and confirm it worked before the next. Never
ask the owner to paste a secret into the chat; have them put it where the step says. These steps
were written from the first owner's working setup, not re-run on a fresh account, so if
Cloudflare's screens or commands have changed, check Cloudflare's current documentation and say
so plainly instead of guessing.

Every blank to fill in is written `YOUR-...` or `YOUR_...`. To see them all:

```bash
grep -rn "YOUR[-_]" --include=*.jsonc --include=*.md --include=*.ts --include=*.tsx .
```

## 0. Look at it first (optional, no accounts needed)

**AI:** install, create the local database, load the made-up program, and build the page:

```bash
npm install
```

```bash
npm run db:migrate:local
```

```bash
npx tsx scripts/import-program.ts scripts/sample-program.json --local
```

```bash
npm run build:web
```

Then run both servers, each in its own terminal:

```bash
cd workers/app && npx wrangler dev --local-upstream localhost:8787 --var ENVIRONMENT:local
```

```bash
cd workers/mcp && npx wrangler dev --port 8788 --inspector-port 9240 --persist-to ../app/.wrangler/state --var ENVIRONMENT:local --var PUBLIC_URL:http://localhost:8788 --var MCP_TOKEN:testtoken
```

And fill it with four months of made-up numbers, lifts and notes:

```bash
npx tsx scripts/seed-local.ts
```

The page is at http://localhost:8787. Sign-in is skipped only on localhost. Take screenshots
on a desktop and a phone width to show the owner.

## 1. Cloudflare account, a domain, and a key for GitHub

**You:**

1. Create a Cloudflare account at dash.cloudflare.com if you do not have one.
2. Note your **Account ID** (shown on the Workers & Pages overview page).
3. Open Workers & Pages once so Cloudflare gives you a `workers.dev` address. Note the
   subdomain: in `something.workers.dev` it is the `something`.
4. Have a domain on Cloudflare (add one you own, or buy one there). The page lives at
   `health.<your domain>`. (Without a domain, ask your AI to put the page on its `workers.dev`
   address instead; the Access steps then cover that address.)
5. Turn on R2 storage (Cloudflare may ask for a payment method; a record this size stays in the
   free allowance).
6. Create an API token (My Profile, API Tokens, Create Token): start from the **Edit Cloudflare
   Workers** template and add **D1: Edit**, **Workers R2 Storage: Edit**, **Access: Apps and
   Policies: Edit** and **Account Settings: Read**; for your domain, **Zone: Edit**, **DNS:
   Edit** and **Workers Routes: Edit**.
7. In your GitHub repository: Settings, Secrets and variables, Actions. Add a repository secret
   `CLOUDFLARE_API_TOKEN` with the token. (Until it exists, every push runs the checks and ends
   with "Not deployed".)

If you work in Claude Code on the web, also give that environment access to Cloudflare so the
AI can run the commands below. Ask it how; it has current instructions for that.

## 2. Fill in your account and addresses

**AI:** replace, everywhere (the two `wrangler.jsonc` files, `CLAUDE.md`, `README.md`):

- `YOUR_ACCOUNT_ID` with the Account ID;
- `YOUR-DOMAIN.com` with the domain;
- `YOUR-SUBDOMAIN` with the `workers.dev` subdomain.

## 3. Create the database and the backup bucket

**AI:**

```bash
npx wrangler d1 create health
```

Put the `database_id` it prints into **both** `workers/app/wrangler.jsonc` and
`workers/mcp/wrangler.jsonc`, replacing `YOUR_D1_DATABASE_ID`.

```bash
npx wrangler r2 bucket create health-backups
```

Leave the bucket private: no public address.

## 4. Lock it to you (Cloudflare Access)

The page must only open for you. Until this is done both servers refuse every request; they
never fall back to open.

**You** (in the Cloudflare dashboard, under Zero Trust; the AI can do most of this through the
Cloudflare API if you prefer, with the token from step 1):

1. Open Zero Trust and choose a team name. That is `YOUR-TEAM`.
2. Keep the login method **One-time PIN** (a code sent to your email).
3. Add a self-hosted application named "Health" for `health.YOUR-DOMAIN.com`, session length
   30 days, with one policy ("Only me") that allows only your email address.
4. Add a second self-hosted application, "Health chatbot sign-in", for the single path
   `health-mcp.YOUR-SUBDOMAIN.workers.dev/authorize`, with the same policy. The rest of that
   address is deliberately not behind Access (chat apps have to reach it); it is protected by
   sign-in tokens instead.
5. Each application has an **Application Audience (AUD) tag**. Copy both.

**AI:** in `workers/app/wrangler.jsonc` replace `YOUR-TEAM` and `YOUR_ACCESS_AUD` (the first
application's tag). In `workers/mcp/wrangler.jsonc` replace `YOUR-TEAM` and
`YOUR_MCP_ACCESS_AUD` (the second application's tag). Replace `YOUR-TEAM` in `CLAUDE.md` too.

## 5. First deploy

**AI:** run `npm run lint && npm run typecheck && npm test`, commit, and push to `main`. The
Deploy action builds, tests, creates the tables and puts both Workers online. Watch the run and
fix anything it reports.

## 6. Your email, on both Workers

Set after the first deploy, because the Workers have to exist. Each command asks for the value;
nothing is written to the repository.

**You or AI:**

```bash
npx wrangler secret put OWNER_EMAIL -c workers/app/wrangler.jsonc
```

```bash
npx wrangler secret put OWNER_EMAIL -c workers/mcp/wrangler.jsonc
```

**AI:** check the doors are shut (`CLAUDE.md`, "Checking a deploy without his login"): the page
answers with a redirect to the Cloudflare login, `/mcp` answers 401, and `/authorize` redirects
to the login. Anything else means a door is open: fix that first.

## 7. Open it

**You:** go to `https://health.YOUR-DOMAIN.com`. Cloudflare asks for your email and sends a
code. The page opens, empty.

## 8. Connect your chatbot (this is the main way you will use it)

**You**, in Claude (web, phone and desktop share connectors):

1. In a web browser, go to claude.ai/settings/connectors. (Use the website for this; adding it
   from the desktop app's dialog failed when this was first set up.)
2. Choose **Add custom connector**, name it Health, and paste
   `https://health-mcp.YOUR-SUBDOMAIN.workers.dev/mcp`.
3. Press **Add**, sign in with your email code, then press **Allow**.

Other chat apps that can add a custom MCP connector (ChatGPT, GrokBot and others) use the same
address. They all share the same record.

Then, in the Claude app on your iPhone: **"Update my health page."** It reads Apple Health and
answers in one line with a link. The first sync brings in the last 30 days.

## 9. Your food, your program, your library

All of this is optional, and all of it is done by talking to your chatbot, except loading a
program or a library, which your AI does once from a session with the Cloudflare token.

- **Food.** Log food in the app you like (Carbon Diet Coach, MacroFactor or similar) and let it
  write to Apple Health; each sync brings it in. Send your chatbot a screenshot of the app's
  targets or check-in and say "save my macro targets". If your app does not send fiber to Apple
  Health, send a screenshot of its fiber list and say "update my fiber tracking".
- **Your lifting program.** **AI:** get the program into the shape of
  `scripts/sample-program.json` (sessions in order, each exercise with its sets, reps, rest,
  substitutions, notes and an optional video link; what is allowed is `programImportSchema` in
  `packages/core/src/coach.ts`). From a spreadsheet, write a small parser for its layout. Work in
  a scratch folder outside the repository: a bought program is copyrighted, and the file and
  the JSON must never be committed. Then:

  ```bash
  NODE_USE_ENV_PROXY=1 npx tsx scripts/import-program.ts /path/outside/repo/program.json
  ```

- **Your library.** The coach answers training and diet questions from the sources you trust,
  with the page or the link, instead of from general health advice. **AI:** for a book or a
  program's handbook as a PDF, `scripts/parse-pdf.py` (its comment says how), then
  `scripts/import-library.ts`. For a website you trust, scrape each article to Markdown, write a
  parser for that site's layout into the same JSON shape (title in `section`, link in `url`),
  and load it with `import-library.ts`. `CLAUDE.md` ("Loading a program or the library") has the
  details. Again: scratch folder only, never in the repository.

## 10. Make it yours

**AI:**

- **Time zone.** Days are counted in `America/New_York` (`TIMEZONE` in
  `packages/core/src/health.ts`). Apple Health's daily buckets must start at local midnight, so
  this must be the owner's time zone. Change it there and in `scripts/seed-local.ts`; the
  tests are written for an Eastern time zone, so update their UTC times too, and run
  `npm test`.
- **The weather.** The forecast is for New York (Central Park). `packages/core/src/weather.ts`
  says how to find another place's grid square (`FORECAST_URL`, `WEATHER_PLACE`), and its test
  in `workers/mcp/test/tools.test.ts` names the place.
- **Your name** at the foot of the sidebar: `Alex Morgan` in `apps/web/src/App.tsx`.
- **Fixed weekly events.** The sample data says basketball every Thursday (migration
  `0005_coach.sql` adds it to `weekly_fixtures`). Before the first deploy, edit that line to
  the owner's own fixed events, or remove it; after a deploy, add a new migration instead.
- **The chatbot's standing instructions.** `INSTRUCTIONS` in `workers/mcp/src/tools.ts` still
  describe the first owner ("he", biking, basketball, a ten-day program week). Rewrite them in
  the new owner's terms.
- **`CLAUDE.md`.** Rewrite "What this is" to describe the new owner, and keep it current from
  then on. Remove history that no longer applies.
- **`README.md`.** Replace it with a plain description of the new owner's health page.
