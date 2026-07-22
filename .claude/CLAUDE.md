# CLAUDE.md — boilerplate_backend

## Language & spelling

Displayed language is English; user-facing copy uses **Australian/British spelling**
(`colour`, `organisation`, `centre`, `optimise`, `behaviour`, `licence`, `catalogue`,
`customise`, `authorise`, `analyse`). **US English is accepted in the codebase** —
identifiers, CSS properties/values, library APIs, and config keys stay US-spelled
(`color`, `center`, `initialize`, `background-color`, `text-center`, `Authorization`);
do NOT "correct" those. Rule of thumb: if a human reads it as words → AU/British; if a
machine parses it as a symbol → leave it US.

## Git

This is its own independent git repository. Run git operations (branch, commit, push)
from **inside this repo**. The parent `xbg/` folder is a coordination workspace, not a
repo — never commit from there.

## Storage-layer ownership

This is a **boilerplate/template** (`.firebaserc` default is the placeholder
`your-project-id`) — it owns no live database and deploys to no shared project as-is.
Changes here propagate to every service scaffolded from it, so treat storage-layer
patterns with extra care:

- Do NOT wire this template to a real shared Firebase project, and never run
  `firebase deploy` against `xbgsolutions` (or any live project) from here.
- Keep the multi-database connector pattern intact (services select their owned
  database via `firestoreName`/`*_DATABASE_ID`); a scaffolded service owns only its
  own database(s), never a shared one it merely reads.
