# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Vue + Vite for the local interface; Node.js/TypeScript for the local collector and API.

## Users

One experienced specialist on their own computer, looking for their next role. They review a small queue of relevant roles several times a day and want to act quickly without re-reading rejected listings. Each user describes what they are looking for in a local, uncommitted profile.

## Product Purpose

Worklooker combines public job boards, company career pages, Telegram channels, and an explicitly authorised Telegram conversation into one local decision queue. It filters vacancies against the user's own profile (target roles, field, seniority, skills, remote requirement) and lets the user keep or decline each one.

## Positioning

The product converts scattered job feeds into a durable personal decision system: a like saves a job and opens the real posting, while a rejection is remembered across future collections.

## Operating Context

The collector runs locally and is started manually or by a local scheduler. The user opens a browser at localhost to review cards, likes, and saved jobs. A Telegram client session, if configured, reads only the user's chat with `@wantapply_bot`.

## Capabilities and Constraints

- The profile lives in `worklooker.local.json`, outside Git; `worklooker.example.json` is a frontend example. A coding agent can write the profile from the user's resume or an interview (see AGENTS.md).
- Remote-only filtering and a preference for a Russian-speaking environment are profile switches.
- Senior roles in the user's field may be retained for manual review when they are not a target role.
- A vacancy identity is the normalized role and company name; updated postings retain their prior status.
- Liked jobs are visible in a dedicated section. Removing a like returns a job to the new queue.
- Rejected jobs go to a local JSON archive and never appear in the new queue.
- The profile can exclude roles by title, industries anywhere in the text, Russian employers and roles that require working from Russia, roles that require working from the United States, roles a source limits to countries the user does not work from, and Telegram posts older than a set number of days. Career boards list only open roles, so their age is shown but never filters.
- A sources view shows each source's last collection: how many vacancies passed the profile, how many were filtered out and why (with example titles), and the user's decisions on it. Sources can be switched off there.
- Sources blocked by authentication or anti-bot protection report an error; the product does not bypass those protections.
- Telegram API credentials and session data are local-only and excluded from source control.

## Evidence on Hand

There are no supplied brand assets, screenshots, or visual references.

## Product Principles

1. The next decision should be obvious in seconds.
2. A decision must persist across repeated collection runs.
3. Every recommendation is explainable by its role, stack, remote status, or language signal.
4. Collection failures must be visible without preventing review of available jobs.

