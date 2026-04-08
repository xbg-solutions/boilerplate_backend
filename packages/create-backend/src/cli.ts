#!/usr/bin/env node

/**
 * @xbg.solutions/create-backend CLI
 *
 * Scaffolds and syncs XBG backend projects.
 *
 * Usage:
 *   npx @xbg.solutions/create-backend              # Interactive project init
 *   npx @xbg.solutions/create-backend --sync       # Sync/update existing project
 *   npx @xbg.solutions/create-backend --add-util   # Add a utility to existing project
 */

import { Command } from 'commander';
import { initProject } from './commands/init';
import { syncProject } from './commands/sync';
import { addUtility } from './commands/add-util';

const pkg = require('../package.json');

const program = new Command();

program
  .name('create-xbg-backend')
  .description('Scaffold and manage XBG backend projects')
  .version(pkg.version);

program
  .command('init')
  .description('Initialize a new XBG backend project')
  .option('-d, --directory <path>', 'Target directory', '.')
  .option('-n, --name <name>', 'Project name')
  .option('-c, --config <path>', 'Path to setup-config.json for non-interactive setup')
  .option('--skip-install', 'Skip npm install')
  .action(async (options) => {
    await initProject(options);
  });

program
  .command('sync')
  .description('Sync/update an existing project with latest boilerplate changes')
  .option('-d, --directory <path>', 'Project directory', '.')
  .option('--check-only', 'Only check for updates, do not apply')
  .action(async (options) => {
    await syncProject(options);
  });

program
  .command('add-util')
  .description('Add a utility package to an existing project')
  .option('-d, --directory <path>', 'Project directory', '.')
  .action(async (options) => {
    await addUtility(options);
  });

// Default to init if no command specified, but check for --config flag
if (process.argv.length <= 2) {
  initProject({ directory: '.' }).catch(console.error);
} else if (process.argv.length <= 4 && (process.argv.includes('--config') || process.argv.includes('-c'))) {
  // Handle: npx create-backend --config setup-config.json (no "init" subcommand)
  const configIdx = process.argv.indexOf('--config') !== -1
    ? process.argv.indexOf('--config')
    : process.argv.indexOf('-c');
  const configPath = process.argv[configIdx + 1];
  initProject({ directory: '.', config: configPath }).catch(console.error);
} else {
  program.parse();
}
