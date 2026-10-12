# Community backend: research and proposal

Status: research, 2026-10-12. Nothing built, nothing changed on any server.
Backlog row: "Community game database" (docs/BACKLOG.md). Related rows: "Public button layouts", "Light, opt-in telemetry for troubleshooting".

**Short version.** PostgreSQL runs on the Neon Debris game box. It runs as Docker containers inside the Nakama compose projects. It is not a system service. Give DS5 **its own Postgres container**, with its own compose project, volume, role and backups, and don't share Nakama's database server. Put a small Node/TypeScript API in front of it on `api.42pixelstudios.com/ds5/v1/`, behind the Caddy that already runs on that box. The app reads a **signed static snapshot**. The snapshot is signed in GitHub Actions, never on the server. The live API only takes submissions.

---

## 1. Where PostgreSQL lives today

Checked over SSH on 2026-10-12 with read-only commands. Local docs agree: `42pixelstudios/CLAUDE.md`, `auto_battler/tools/deploy_nakama.sh` and `nextcloud-dev/README.md`.

**The box.** Hostname `neon-debris-nakama`. Hetzner Cloud CPX11 in Hillsboro (us-west), running Ubuntu 24.04.3 LTS. It is the box behind `42pixelstudios.com`.

| What | How it runs | Exposure |
|---|---|---|
| PostgreSQL (prod) | Docker container `nakama-postgres-1`, image `postgres:15-alpine` (**15.17**). Compose project `/root/nakama`, volume `nakama_pgdata`. Superuser `postgres`, database `nakama`. | Only on the compose network (`5432/tcp` not published to the host). |
| PostgreSQL (test) | Docker container `nakama-test-postgres-test-1`, same image. Compose project `/root/nakama-test`, volume `nakama-test_pgdata_test`. | Same, not published. |
| Nakama prod / test | `heroiclabs/nakama:3.39.0`. | Ports 7349-7351 (prod) and 7360-7361 (test) published on all interfaces and allowed in ufw. |
| Caddy | v2.11.3, system service (active), `/etc/caddy/Caddyfile`. One site block: `42pixelstudios.com, www.42pixelstudios.com` (static `file_server` from `/var/www/42pixelstudios`). There are no `reverse_proxy` entries yet. Admin API on localhost:2019. | 80/443 |
| System PostgreSQL | Not installed (`postgresql` service inactive, no `psql` on the host). | none |

**Resources at the time of the check:**
- CPU: 2 vCPU, load average about 0.1. Uptime 180 days.
- RAM: 1.9 GB total, about 1.1 GB "available" (that counts page cache). **There is no swap.**
- Containers use little memory: Nakama about 40 MB each, Postgres 52 MB (prod) and 112 MB (test).
- Disk: 38 GB, 29 GB free. The database volumes total about 230 MB. About 620 MB of old Docker images could be reclaimed.

**Things I noticed** (outside this task's scope; listed for the user, none of them acted on):
- **Database backups are manual and stale.** `/root/backups` holds one `pg_dump` per database from **2026-07-11**, on the same disk as the data. No cron job or systemd timer makes new ones.
- **I couldn't check whether Hetzner's own server backups or snapshots are enabled.** They are not visible from inside the box; the Cloud Console shows them.
- **The Nakama admin console ports (7351, 7361) are open to the internet** in ufw. Nakama's console has its own login, but it would normally sit behind SSH tunnelling or an IP allowlist.
- **There is no swap on a 2 GB box.** A memory spike from the game backend (or from anything new) gets OOM-killed instead of slowing down.

**Not verified:**
- Hetzner backup and snapshot settings (Console only).
- Whether Caddy writes access logs. Only the site address lines of the Caddyfile were read, on purpose.
- Network and traffic quotas. I didn't read any compose files on the server; the local copy of the Nakama compose file was read with secret values redacted.

**The other boxes, for context.**
- `collabora-de` (CPX32, 4 vCPU and 7.6 GB, Falkenstein in Germany) runs Collabora and Vaultwarden behind its own Caddy. It has much more headroom and an EU location, but it isn't "next to the 42PS site". See Open questions.
- The Storage Share Nextcloud is managed by Hetzner and can't host anything.

## 2. Recommendation: separate Postgres container, own role

**Don't put DS5 tables in Nakama's database or use Nakama's `postgres` user.** The backlog already rules that out.

The remaining choice is between two options:
- (a) A new database and role inside the existing `nakama-postgres-1` server.
- (b) A **separate `postgres:17-alpine` container** in its own compose project, for example `/root/ds5-community`.

**Recommendation: (b), a separate container.**
- **Blast radius.**
  - The live game backend can't be hurt by a DS5 migration, a runaway query or a disk-filling table, and the other way round.
  - Restarting or upgrading one never restarts the other.
  - The DS5 API never needs any credential that can reach the Nakama server, whose only login today is the superuser.
- **Independent upgrades.**
  - Nakama pins Postgres 15. DS5 can start on a current major version (17) and follow its own schedule.
  - Nakama upgrades (which run `nakama migrate up` against that server) don't touch DS5.
- **Independent backup and restore.** Restoring DS5 after a bad deploy never means rolling back game data.
- **Resource caps.** Compose `mem_limit` and `cpus` per container keep DS5 from starving the game on a 2 GB box.
- **Easy to move later.** If DS5 outgrows the CPX11, or the user wants it in the EU, the whole compose project moves (`pg_dump` and restore) without touching Nakama.
- **Cost.** About 30-60 MB more RAM for an idle small Postgres with tuned settings (`shared_buffers=32MB`, `max_connections=20`). That's acceptable, with the swap note below.

Inside that container:
- An owner role `ds5_owner` runs migrations only.
- An app role `ds5_api` has `SELECT/INSERT/UPDATE/DELETE` on the app tables only. It has no DDL rights and no superuser.
- The superuser password is only used for initial setup.
- The container publishes **no port**. The API reaches it over the compose network.

**Before adding anything to this box:**
1. Add a 1-2 GB swapfile.
2. Set `mem_limit` on the new containers (Postgres about 192 MB, API about 128 MB).
3. Optionally resize CPX11 to CPX21 in the Hetzner Console (a few euros a month, and a reboot). That's the user's call.

## 3. Proposed architecture

```
                         GitHub Actions (scheduled, hourly or daily)
                         pulls raw export -> aggregates -> bounds checks
                         -> signs games.json with the COMMUNITY key (Actions secret)
                         -> publishes to GitHub (fallback) and uploads to the server
                                  |                         |
DS5 app --GET signed snapshot-->  api.42pixelstudios.com/ds5/v1/snapshot/*  (Caddy file_server, static)
        --GET fallback-------->  raw.githubusercontent.com/.../community/games.json(.sig)
        --POST report-------->  api.42pixelstudios.com/ds5/v1/reports  -> Caddy -> ds5-api (127.0.0.1:8787)
                                                                                 -> ds5-postgres (compose network only)
```

**Stack: Node 22 LTS, TypeScript and Fastify, with `pg`.**
- It's the same language as the app, so the report schema and enums can be shared as one TypeScript module.
- The Nakama modules on the same box are TypeScript too.
- Fastify has JSON-schema validation built in and an official rate limiter (`@fastify/rate-limit`).

Go would use less memory, but it would add a second language for one small service. Node is about 60-90 MB resident, which fits.

The API runs in Docker from the same compose project, bound to `127.0.0.1:8787`.

**Caddy.** Add a block to the existing Caddyfile:

```
api.42pixelstudios.com {
    request_body { max_size 8KB }
    handle_path /ds5/v1/snapshot/* { root * /var/www/ds5-snapshot; file_server; header Cache-Control "public, max-age=300" }
    handle /ds5/v1/* { reverse_proxy 127.0.0.1:8787 }
    log { output discard }  # or log without the client IP (see Privacy)
}
```

- Add DNS A and AAAA records for `api` in the Hetzner DNS zone (the "konsoleH" Cloud project).
- Caddy issues the certificate automatically. 80/443 are already open.
- Use `api.` plus a `/ds5/` path rather than `ds5.42pixelstudios.com`, so the subdomain can serve other studio APIs later. Either works.
- Note: Mullvad DNS on the dev PC caches negative answers, so test a new record with DoH.

### Endpoints (v1)

**Reads.** These are static, signed files served by Caddy, not the API.

| Path | What |
|---|---|
| `GET /ds5/v1/snapshot/games.json` + `games.json.sig` | Games. Each game has a tier, an aggregate rating, a count, and feedback tag counts, split per controller model. |
| `GET /ds5/v1/snapshot/layouts.json` + `.sig` (phase 3) | Approved shared layouts and trigger sets. |

**Writes.** These go to the API.

| Path | What |
|---|---|
| `POST /ds5/v1/reports` | Submit or replace a rating and feedback tags for one game and one controller model (upsert per install). |
| `DELETE /ds5/v1/reports` | Delete everything this install submitted. The `install_id` goes in the body. |
| `POST /ds5/v1/games` | Propose a game that isn't in the snapshot (non-Steam). It goes to moderation. |
| `POST /ds5/v1/layouts` (phase 3) | Submit a layout or trigger set. It goes to moderation. |
| `GET /ds5/v1/health` | Liveness check. |
| `GET /ds5/v1/internal/export` | Raw rows for the CI aggregator. Requires a bearer token (an Actions secret). Could instead be served only over an SSH tunnel. |

**Moderation** (phase 2 and later). A small admin CLI run over SSH. For example, `docker compose exec ds5-api node admin.js pending`, then `approve <id>`. It's the same pattern as the existing deploy scripts. There is no public admin UI.

### Signed reads: where the key lives

The update feed's scheme carries over directly:
- It uses Ed25519 over the exact bytes, with a base64 `.sig` file beside the data and a `TRUSTED_KEYS` list (`electron/main/feedSignature.ts`, used in `electron/main/updater.ts`).
- The check is `feedSignedBy(text, sig, keys)` and can be reused unchanged.

Two rules make it actually protect against a compromised server:
1. **The signing key never touches the API box.** If the server signed its own responses, an attacker who owned the server would own the key too.
   - Instead, a scheduled **GitHub Actions** workflow:
     1. Pulls the raw export.
     2. Runs a deterministic aggregation with hard bounds and per-install caps.
     3. Signs the result with a key held only as an Actions secret.
     4. Publishes the result twice: to the repo (the GitHub fallback the backlog already wants), and to `/var/www/ds5-snapshot` on the server, using a deploy key that can only write that folder (for example a forced-command `rrsync` key).
   - A compromised server can then inject fake *reports*, which the aggregation caps limit. It can't serve a signed snapshot the CI didn't produce.
2. **Use a separate community key, not the release key.**
   - Add `TRUSTED_COMMUNITY_KEYS` beside `TRUSTED_KEYS`, so a leaked community key can never sign an update feed.
   - Put a `"kind": "ds5-community-games"` field and a `schema` version in the signed JSON, so a file of one kind can't be passed off as another.

The app side:
- **Verify before parsing.**
- **Keep the last good snapshot** on disk and show it when offline.
- **Reject a snapshot older than the cached one** (compare `generated_at`), which blocks rollback.
- **Clamp every value to its schema** (rating 1-5, known tag enums, known colorway codes) even after the signature checks out.

### Anti-abuse

- **Install ID.** A random 128-bit ID is generated when the user first opts in and stored in the app settings. It isn't derived from hardware or the dongle serial.
  - The server stores only `HMAC-SHA256(server_pepper, install_id)`.
  - A "Reset my community ID" button makes a new one, and deleting first is offered.
- **One report per install, game and controller model.** Upsert, not append, so one install can't stack votes.
- **The aggregator ignores outliers.** It drops installs that submit more than N games per hour, and it shows a tier only after at least K distinct installs (for example K = 3), which also stops one person from "deciding" a game.
- **Rate limits** are kept in API memory (by IP and by install hash), for example 30 writes per hour per IP. IPs are never written to the database.
  - Stock Caddy has no rate limiter. The `caddy-ratelimit` plugin would need a custom build, so do it in Fastify.
- **Size limits.**
  - The body is capped at 8 KB in Caddy.
  - Strict JSON schema with `additionalProperties: false`.
  - Tags come from a fixed enum, and colorway codes from the app's known list.
  - Layouts are validated against the app's own layout schema.
- **No free text in phase 2.**
  - Proposed game names and layout names go to a moderation queue and are shown only after approval.
  - Proposals are matched to Steam app IDs where possible.
- **Kill switch.** `SUBMISSIONS_OPEN=false` makes the API return 503 while the snapshot keeps serving.

### Caching

- **The app.** Checks the snapshot at launch, and at most every 6 hours while it runs. It uses `If-None-Match` and keeps an on-disk cache.
- **Caddy.** Serves the static files with an ETag and `max-age=300`. A CDN (Bunny or Cloudflare) can be put in front later without changing the app.
- **The fallback path.** GitHub raw is used when `api.` is unreachable, so an outage of the box never breaks the Games page.
- **Load.** Reads never reach Node or Postgres. The API only sees submissions, which are rare.

### Backups

- **Nightly dump.** Run `pg_dump -Fc` on a host systemd timer (`docker compose exec -T ds5-postgres pg_dump ...`). Keep 14 daily and 8 weekly copies.
- **Copy off the box** to the studio's Storage Share (WebDAV via rclone) or to a Hetzner Storage Box. A backup on the same disk isn't a backup.
- **Test a restore** into a throwaway container once, and then after each Postgres major upgrade.
- **The data is rebuildable.** The signed snapshots on GitHub are a second, aggregate-level copy. Raw reports would be lost, but tiers and ratings would survive.
- **Do the same for Nakama** (see the notes in section 1). That's a separate decision for the user.

### Migrations

- Plain numbered SQL files (`migrations/0001_init.sql`, ...) live in the API repo or folder.
- **dbmate** applies them: a single static binary with a `schema_migrations` table and up/down blocks. `node-pg-migrate` would work too.
- They run as `ds5_owner` in a one-shot compose service before the API starts.
- Forward-only in practice. Write additive changes, and take a backup before each deploy.
- **Deploy script.** Like `deploy_nakama.sh`:
  1. Build the image locally or in CI.
  2. Copy it to the box.
  3. Run `docker compose up -d ds5-api` (only the DS5 project, never Nakama's).
  4. Check `/health`.

## 4. Data model sketch

```sql
-- games known to the community DB
create table games (
  id            serial primary key,
  key           text unique not null,      -- 'steam:1091500', 'gog:1423049311', 'epic:<ns>', 'name:<normalized>'
  display_name  text not null,             -- from Steam/curated list; user proposals only after approval
  status        text not null default 'approved' check (status in ('pending','approved','rejected')),
  created_at    timestamptz not null default now()
);

-- one row per install x game x controller model (upsert)
create table reports (
  id                bigserial primary key,
  game_id           int not null references games(id),
  install_hash      bytea not null,          -- HMAC(pepper, install_id); never the raw ID
  controller_model  text not null check (controller_model in ('dualsense','dualsense_edge')),
  colorway_code     text,                    -- from the app's known list, validated
  firmware_version  text not null,           -- dongle firmware, e.g. '0.9.4'
  app_version       text not null,
  os_family         text check (os_family in ('linux','windows','macos')),
  rating            smallint not null check (rating between 1 and 5),
  tags              text[] not null default '{}',  -- enum values: 'triggers_work','haptics_work','no_triggers','needs_proton_ge',...
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (game_id, install_hash, controller_model)
);

-- phase 3
create table shared_layouts (
  id            bigserial primary key,
  game_id       int references games(id),
  kind          text not null check (kind in ('buttons','triggers')),
  name          text not null,               -- shown only after approval
  payload       jsonb not null,              -- validated against the app's layout schema, size-capped
  controller_model text not null,
  install_hash  bytea not null,
  status        text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at    timestamptz not null default now(),
  reviewed_at   timestamptz
);
```

Aggregates (tiers, mean ratings, tag counts per controller model) are **computed by the CI aggregator into the snapshot**. They aren't stored as tables, so there is one source of truth.

**Not stored:**
- Controller or dongle serials, Bluetooth MAC addresses, or USB serials.
- IP addresses. They are held in memory only for rate limiting, and access logs are off or kept without the IP.
- Raw install IDs.
- User names, accounts, emails or OS user names.
- The library itself (which games someone owns). Only games the user actively rates are sent.
- Free text, except moderated game and layout names.
- Telemetry. That goes to a separate table and endpoint with a separate ID (section 5).

## 5. Privacy

**What's sent.** On submit, and only after opt-in:
- The game key.
- Controller model and colorway code.
- Dongle firmware version, app version and OS family.
- The rating and tags.
- The hashed random install ID.

Nothing is sent in the background.

**Opt-in.**
- Reading the community snapshot is a plain GET with no ID. It can be on by default, with an off switch, because it reveals no more than the update check.
- **Submitting is opt-in.** The first Rate or Share click shows a short dialog listing exactly the fields above, with "Send" and "Don't ask again" options.
- The settings get two controls: "Community: share ratings" and "Delete my submissions" (which calls `DELETE /reports`, then resets the ID).

**Retention.**
- Reports are kept while they count, with a limit. For example, reports older than 24 months, or more than two major firmware versions old, drop out of the aggregate and are deleted.
- Rejected moderation items are deleted after 30 days.
- Backups expire as described in section 3.

**Where it's described.**
- One "Community data" section in the README and in SECURITY_AUDIT.
- The same plain list in the opt-in dialog.
- A public page at `42pixelstudios.com/ds5/privacy` (static, in the site repo).
- The lists must match. Per the backlog rule, no wording about it goes in the app until it exists.

**Hosting location.** The box is in the US (Hillsboro). With no personal data (no IPs or accounts stored, and only a hashed random ID), the GDPR exposure is small. The studio still chose Germany for Collabora for exactly this kind of reason. See Open questions.

**Relation to telemetry.**
- The opt-in troubleshooting telemetry (the Development channel row) is a **separate opt-in, with a separate endpoint (`/ds5/v1/telemetry`), table and random ID.** The two datasets can't be joined, and turning one off doesn't affect the other.
- It can share the same API process and database.
- Shorter retention, for example 90 days.
- Never game titles, unless the user asks.

## 6. Phased plan

| Phase | What | Server needed? | Rough effort |
|---|---|---|---|
| 0. Prep (user's call) | Swapfile on the box. Nakama database backups on a timer and copied off the box. Decide whether to resize the box. Optionally lock the Nakama console ports. | Changes to the existing box | 0.5 day |
| 1. Read-only snapshot | Curated `games.json` built from `DS5Dongle/DUALSENSE_GAME_LIST.md`. A community signing key, with signing in CI. Published to GitHub raw. App: fetch, verify, cache, show tiers on the Games page, `TRUSTED_COMMUNITY_KEYS`. Optional: also published to `api.42pixelstudios.com/ds5/v1/snapshot/` via Caddy `file_server` (DNS plus one Caddy block, no database yet). | No (or Caddy only) | 2-3 days |
| 2. Submissions | DS5 compose project (Postgres 17 and the Fastify API), dbmate migrations, roles, rate limits, export endpoint, CI aggregator, backups timer. App: opt-in dialog, Rate/feedback UI, delete-my-data, privacy docs. | Yes | 5-8 days |
| 3. Shared layouts and trigger sets | `shared_layouts`, layout schema validation, moderation CLI, `layouts.json` snapshot. App: Share and browse. | Yes | 4-6 days |
| 4. Telemetry | Separate endpoint and table, Development channel join dialog line, 90-day retention. | Yes | 2-3 days |

Each phase ships on its own. Phase 1 already gives users value and proves the signing path before anything accepts writes.

## Open questions for the user

1. **Which box.**
   - Option A is the US game box. It's next to the site and matches the backlog idea, but it's tight on RAM and shares space with the live game.
   - Option B is `collabora-de`. It's in the EU with plenty of headroom, but it has its own Caddy, so it would be a different subdomain on that box.
   - Option C is resizing the game box to a CPX21 and keeping everything together.
2. **Separate Postgres container (recommended) or a new database and role in Nakama's Postgres server?**
3. **Subdomain.** `api.42pixelstudios.com/ds5/v1` or `ds5.42pixelstudios.com`?
4. **Snapshot cadence.** Hourly or daily CI aggregation? Daily is enough at launch and spends fewer Actions minutes.
5. **Who moderates, and how fast?** Is an SSH admin CLI OK, or should pending items show up as GitHub issues for review?
6. **Tier rules.** The minimum number of installs before a game gets a tier (K), and what the tiers mean (for example "Full triggers and haptics / Triggers only / Rumble only / Broken").
7. **Retention numbers.** 24 months for reports and 90 days for telemetry, as proposed above?
8. **Should Nakama's backups be fixed in the same pass?** The last dump is from 2026-07-11, it's on the same disk, and there's no schedule.
