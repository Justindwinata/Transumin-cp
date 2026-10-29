# Phase 1 multi-operator source-rights record

Retrieved and reviewed on 2026-09-29.

| Publisher                         | Dataset/publication                                    | Rights evidence                                                                                                                                                                                                                               | License status | Redistribution | Automation |
| --------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------- | ---------- |
| PT Kereta Commuter Indonesia      | Commuter Line Jabodetabek GAPEKA 2025 timetable        | Official website/PDF; direct access returned HTTP 403; no open license located                                                                                                                                                                | UNKNOWN        | UNKNOWN        | UNKNOWN    |
| PT MRT Jakarta (Perseroda)        | Official departure schedule                            | [Schedule](https://www.jakartamrt.co.id/id/jadwal-keberangkatan-mrt) and [disclaimer](https://www.jakartamrt.co.id/id/peringatandisclaimer)                                                                                                   | UNKNOWN        | UNKNOWN        | UNKNOWN    |
| PT LRT Jakarta                    | 2026-09-16 Kelapa Gading–Manggarai network publication | [Official publication](https://mail.lrtjakarta.co.id/lrt_jakarta_resmi_terhubung_hingga_manggarai_siap_dukung_mobilitas_dan_konektivitas_masyarakat_jakarta_pers484.html) and [copyright policy](https://kebijakan-privasi.lrtjakarta.co.id/) | UNKNOWN        | UNKNOWN        | UNKNOWN    |
| PT Kereta Api Indonesia (Persero) | LRT Jabodebek schedule and route pages                 | [Schedule](https://lrtjabodebek.kai.id/jadwal-keberangkatan) and [route](https://lrtjabodebek.kai.id/informasi-peta-rute); no open license located                                                                                            | UNKNOWN        | UNKNOWN        | UNKNOWN    |

Public accessibility is not treated as permission. None of these four sources is redistributed or canonically ingested in Phase 1. Permission and stable machine-data access must be established before an adapter is activated.

## Phase 4 re-verification — 2026-10-01

- KAI Commuter's official GAPEKA 2025 PDF became retrievable through an official `kci.id` redirect (2,395,416 bytes; SHA-256 `5a5f067f1ac79e5b8a8aec8dbb613021678afef5b351fb9e42242b0fbbdc98a4`) and contains exact timetable facts, but no open license, automation permission, or derived-feed redistribution permission was located.
- MRT Jakarta's official schedule route remains public but requires JavaScript and does not expose a stable documented bulk feed. Its disclaimer prohibits commercial reuse without prior approval; automation and redistribution remain `UNKNOWN`.
- LRT Jakarta's official 2026-09-16 publication supplies the 11-station Manggarai topology, 10-minute headway, and operating window, but the publishing subdomain fails normal TLS hostname validation and the copyright/disclaimer does not establish automation or derived-feed redistribution rights.
- LRT Jabodebek's official pages returned HTTP 200 and expose structured station departure tables and the two-branch topology, but no open license or automation/redistribution permission was located.

## Phase 4A-R local academic processing decision — 2026-10-02

The rights questions were separated instead of treating the absence of an open license as a prohibition on every local research use. The official sources are publicly accessible. No explicit restriction on local noncommercial academic processing or local derived-data creation was found for these facts, so a controlled research representation may be generated locally under a no-redistribution policy. This is not an open-license finding.

- KRL automation, redistribution, commercial use, and attribution remain `UNKNOWN`; the official PDF is handled as a one-time local artifact.
- MRT Jakarta has no explicit automation restriction in `robots.txt`; commercial use `REQUIRES_PERMISSION`; redistribution and attribution remain `UNKNOWN`.
- LRT Jakarta automated retrieval is `VERIFIED_RESTRICTED` by `robots.txt`; local facts come from official public/government publications, raw artifacts are not redistributed, and copyright remains reserved.
- LRT Jabodebek has no explicit automation restriction in `robots.txt`; redistribution, commercial use, and attribution remain `UNKNOWN`; the captured HTML is local-only.

All raw timetable material and the generated controlled routing snapshot remain ignored. Formal operator permission remains recommended for production, recurring automation, redistribution, exact machine feeds, and commercial use. The full decision is recorded in `data/manifests/PHASE-4-ROUTING-CAPABILITY-MATRIX.json` and `docs/audits/PHASE-4A-R-ROUTING-DATA-RIGHTS-RESOLUTION.md`.
