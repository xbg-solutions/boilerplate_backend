#!/usr/bin/env node
/**
 * Regenerate `functions/src/utilities/content-crypto/` from
 * `packages/utils-content-crypto/src/`. The repair for the gate in `check-mirror.js`, which
 * is where the copying actually lives — one tool, two modes, so the two halves cannot hold
 * two different ideas of which files are in the mirror or what "identical" means.
 *
 *   npm run mirror:sync
 *
 * IT IS HOOKED TO NOTHING. Not to a build, not to a test, not to a commit. That is the
 * whole reason it is a separate entry point rather than a flag people would wire into a
 * script: a sync that ran automatically would repair the drift before the check could
 * report it, and the signal would disappear along with the symptom.
 *
 * The mirror is an artefact that happens to be committed. The package tree is the source.
 * Editing the mirror by hand is a CI failure, and this script is how you undo having done
 * it — your edit is deleted, not merged.
 */
'use strict';

const { syncMirror } = require('./check-mirror.js');

process.exit(syncMirror());
