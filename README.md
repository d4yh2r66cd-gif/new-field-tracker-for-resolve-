# FieldTrack

Field activity tracking across many sites and sectors. Each organisation keeps its own sites,
people and records, fully separated from every other organisation on the same server.

Each site is created with a **type**, and the type decides what its equipment tracks:

| Site type | Stages per equipment | Readings it expects | Example equipment |
| --- | --- | --- | --- |
| Agro-processing plant | 10 | Throughput, moisture, dryer temperature, current | Cage-type cleaner, paddle boat washer, peeler, grater, hydraulic press, sifting machine, fryer, conveyor, vibrator, milling machine, packaging machine, scale |
| Poultry processing plant | 10 | Throughput, scalder temperature, chiller temperature, line speed | Live bird receiving cage, scalder, plucker, evisceration table, giblet harvester, chiller, cut-up machine, deboning machine, grading & sizing machine, packaging machine, metal detector, blast freezer |
| Meteorological station | 10 | Air temperature, humidity, pressure, wind, rainfall, battery | Weather station, anemometer, rain gauge, barometer, temperature/humidity sensors, pyranometer, wind vane, data logger |
| Petroleum laboratory | 10 | Density, flash point, sulphur, lab temperature and humidity | Gum tester, flash point tester, distillation apparatus, viscometer, density meter, Karl Fischer titrator, sulphur analyzer, octane analyzer |
| Cold chain facility | 10 | Room and ambient temperature, compressor hours, door openings | Cold room panels, condensing unit, evaporator coil, compressor, temperature data logger, backup generator |
| General field site | 6 | — | — |

Readings with a declared range are flagged automatically when a value falls outside it, and
flagged readings appear in the next progress update without anyone having to remember them. The
example equipment names above show up as autocomplete suggestions when adding equipment to a
site of that type — typing something else is always fine, they're a starting point, not a list.

## What each site holds

- **Equipment register** — every machine on site (a hydraulic press, a dryer, a mast) gets its
  own commissioning checklist, drawn from the site's type, ticked off independently with who and
  when. It also carries make, model, serial and service interval, with status turning to *due
  soon* at 30 days and *overdue* past the date, plus a check-box for "present and working". A
  site's overall progress is the average across whatever equipment it has — nothing to add yet
  means 0%, not blocked.

  Calibration due date is part of this too, except on site types that declare `calibration:
  false` in their definition (agro-processing and poultry processing plants, since process
  machinery like cleaners, peelers, presses, scalders and pluckers isn't calibrated the way a lab
  instrument or sensor is) — there the
  column reads N/A and never counts toward due/overdue status.
- **Daily activity log** — work done, crew size, hours, issues, and up to 6 photos per entry.
- **Readings** — the parameters for that site type, timestamped and attributable.

## Roles

| Role | Can do |
| --- | --- |
| Account owner | Everything, including adding sites and changing people's roles |
| Site lead | Add sites and equipment, tick stages, log work, send updates |
| Technician | Tick stages, log work, record readings, add equipment |
| Senior officer | Read everything, receive updates, acknowledge with a comment |

The first person to set up an organisation becomes its owner and gets a **join code**. Everyone
else uses that code to create their own account. The code is on the Team tab.

## Running it

**Locally:** install Node.js LTS, then double-click `START.bat` on Windows, or run
`node setup.js && npm start`. Open http://localhost:3000.

**Hosted (recommended):** push to GitHub, then on Render use **New → Blueprint** and select the
repo. `render.yaml` sets up the service, the 5 GB persistent disk and the secret key. About
$7.50/month — $7 for an always-on service plus $0.25/GB for the disk holding the database and
photos. The free plan has no disk and sleeps, so data would be lost.

A `Dockerfile` is included for Fly.io, Railway or a VPS.

## How separation between organisations works

Every table carries `org_id`. The token issued at sign-in contains the user's organisation, and
every query filters on it — there is no route that reads or writes a row without that filter.
Requests for another organisation's site return "No such site" rather than a permission error,
so nothing leaks about what exists elsewhere.

This is verified by tests: a user of one organisation cannot read a site, tick a stage, add
equipment, or log work against another organisation, by any route.

## API

All routes except the three below need `Authorization: Bearer <token>`.

```
POST   /api/orgs                     create an organisation + owner account, returns join code
POST   /api/auth/register            { name, email, password, joinCode, role }
POST   /api/auth/login               { email, password } -> { token, user }

GET    /api/site-types               this org's types (built-in + custom) with stages and readings
POST   /api/site-types               owner/lead; { label, accent, stages: [...], readings: [...] }

GET    /api/me                       user + organisation (join code for owners)
GET    /api/users
PATCH  /api/users/:id/role           owner only

GET    /api/sites                    all sites with equipment and progress
POST   /api/sites                    owner/lead
GET    /api/sites/:id                site + equipment (each with its own stages) + readings + logs
PATCH  /api/sites/:id                rename, relocate, set status
DELETE /api/sites/:id                owner only

GET    /api/sites/:siteId/equipment
POST   /api/sites/:siteId/equipment      creates the site type's stage checklist for this item
PATCH  /api/equipment/:id            e.g. { last_service: "2026-09-05" }
POST   /api/equipment/:id/check      { checked: true|false } — present & working, with who/when
POST   /api/equipment/:id/stages/:idx    { done: true|false }
DELETE /api/equipment/:id            owner/lead
GET    /api/equipment/due            everything due or overdue, across all sites

GET    /api/sites/:siteId/readings
POST   /api/sites/:siteId/readings   { taken_on, readings: [{ param, value, equipment_id }] }

GET    /api/logs                     ?siteId= &from= &severity=
POST   /api/logs                     multipart/form-data, field "photos"
POST   /api/logs/:id/resolve

GET    /api/reports/draft            ?siteId= — auto-written from live data
GET    /api/reports
POST   /api/reports                  { title, body, to: [userIds], site_id }
POST   /api/reports/:id/ack          { comment }

GET    /api/export/logs.csv
GET    /api/export/readings.csv
GET    /api/export/equipment.csv
```

## Adding a site type

An owner or site lead can define a new kind of site from within the app: on the "Add a site"
form, choose **+ Add a new kind of site…** from the type dropdown. That opens a small builder —
name it, pick a colour tag, edit the stage checklist (it starts from a general-purpose template
you can rename, add to or trim), and optionally add readings with a unit and a `min`/`max` range
for automatic flagging. Saving makes it available immediately, to everyone in that organisation,
right next to the built-in types. Custom types are scoped to the organisation that created them —
another organisation never sees them.

The five built-in types (agro-processing, meteorological, petroleum, cold chain, general) live in
`templates.js` instead, and are shared by every organisation on the server. To add one of those —
typically only worth doing for a type common enough to ship by default — copy an existing block,
change the label, stages and readings, and it appears everywhere with no other changes.

Either way, a stage checklist is only ever handed out when a piece of equipment is added, so
editing a template never disturbs the checklists already ticked off on existing equipment.

## Security notes

Passwords are bcrypt-hashed and sessions are 30-day JWTs. Photos are served through
`GET /api/photos/:filename`, which requires a valid session and only returns a file if a row in
the caller's own organisation names it — the same `org_id` boundary as every other route. One
thing to handle yourself: serve over HTTPS. Hosting on Render gives you this; a local install
does not.
