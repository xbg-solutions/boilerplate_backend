/**
 * Sync Command
 * Updates an existing project with latest boilerplate changes
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { UTILITY_REGISTRY } from '../utils-registry';

interface SyncOptions {
  directory: string;
  checkOnly?: boolean;
}

interface SyncResult {
  packagesUpdated: string[];
  packagesAdded: string[];
  filesUpdated: string[];
  newUtilitiesAvailable: string[];
}

export async function syncProject(options: SyncOptions): Promise<void> {
  const projectDir = path.resolve(options.directory);
  const functionsDir = path.join(projectDir, 'functions');

  console.log(chalk.bold.blue('\n── XBG Backend Sync ────────────────────────────\n'));

  // Verify this is an XBG project
  if (!await fs.pathExists(path.join(functionsDir, 'package.json'))) {
    console.error(chalk.red('Not an XBG backend project. Run from the project root.'));
    process.exit(1);
  }

  const result: SyncResult = {
    packagesUpdated: [],
    packagesAdded: [],
    filesUpdated: [],
    newUtilitiesAvailable: [],
  };

  // Check for package updates
  console.log(chalk.cyan('Checking for package updates...\n'));

  const pkgJson = await fs.readJson(path.join(functionsDir, 'package.json'));
  const deps = pkgJson.dependencies || {};

  // Check installed @xbg packages
  const installedXbgPackages = Object.keys(deps).filter((d) => d.startsWith('@xbg.solutions/'));

  for (const pkg of installedXbgPackages) {
    const currentVersion = deps[pkg];
    try {
      const latestVersion = execSync(`npm view ${pkg} version 2>/dev/null`, {
        encoding: 'utf8',
        timeout: 10000,
      }).trim();

      if (latestVersion && currentVersion !== `^${latestVersion}`) {
        result.packagesUpdated.push(`${pkg}: ${currentVersion} -> ^${latestVersion}`);
        console.log(chalk.yellow(`  Update available: ${pkg} ${currentVersion} -> ^${latestVersion}`));
      } else {
        console.log(chalk.green(`  Up to date: ${pkg} ${currentVersion}`));
      }
    } catch {
      console.log(chalk.dim(`  Skipped: ${pkg} (not published yet)`));
    }
  }

  // Check for new utilities available
  const allPackageNames = UTILITY_REGISTRY.map((u) => u.package);
  const newUtils = allPackageNames.filter((pkg) => !installedXbgPackages.includes(pkg));

  if (newUtils.length > 0) {
    result.newUtilitiesAvailable = newUtils;
    console.log(chalk.cyan(`\n${newUtils.length} additional utilities available:`));
    for (const pkg of newUtils) {
      const util = UTILITY_REGISTRY.find((u) => u.package === pkg);
      if (util) {
        console.log(chalk.dim(`  ${util.name}: ${util.description} (${pkg})`));
      }
    }
    console.log(chalk.dim(`\n  Run ${chalk.bold('npx @xbg.solutions/create-backend add-util')} to add utilities.`));
  }

  // Sync scaffold files (tsconfig, scripts)
  console.log(chalk.cyan('\nChecking scaffold files...\n'));

  const templateDir = path.resolve(__dirname, '../../src/project-template');

  // Check scripts
  const scriptsDir = path.join(templateDir, '__scripts__');
  if (await fs.pathExists(scriptsDir)) {
    const scripts = await fs.readdir(scriptsDir);
    for (const script of scripts) {
      const templateScript = path.join(scriptsDir, script);
      const projectScript = path.join(projectDir, '__scripts__', script);

      if (!await fs.pathExists(projectScript)) {
        if (!options.checkOnly) {
          await fs.copy(templateScript, projectScript);
          result.filesUpdated.push(`__scripts__/${script}`);
          console.log(chalk.green(`  Added: __scripts__/${script}`));
        } else {
          console.log(chalk.yellow(`  Missing: __scripts__/${script}`));
        }
      } else {
        const templateContent = await fs.readFile(templateScript, 'utf8');
        const projectContent = await fs.readFile(projectScript, 'utf8');

        if (templateContent !== projectContent) {
          if (!options.checkOnly) {
            await fs.copy(templateScript, projectScript);
            result.filesUpdated.push(`__scripts__/${script}`);
            console.log(chalk.yellow(`  Updated: __scripts__/${script}`));
          } else {
            console.log(chalk.yellow(`  Outdated: __scripts__/${script}`));
          }
        } else {
          console.log(chalk.green(`  Current: __scripts__/${script}`));
        }
      }
    }
  }

  // Apply updates
  if (!options.checkOnly && result.packagesUpdated.length > 0) {
    console.log(chalk.cyan('\nUpdating packages...\n'));
    try {
      execSync('npm update', { cwd: functionsDir, stdio: 'inherit' });
      console.log(chalk.green('Packages updated.'));
    } catch {
      console.error(chalk.red('Failed to update packages. Run npm update manually.'));
    }
  }

  // Summary
  console.log(chalk.bold.green(`\n── Sync Complete ───────────────────────────────\n`));
  console.log(`  Packages checked:  ${installedXbgPackages.length}`);
  console.log(`  Updates available: ${result.packagesUpdated.length}`);
  console.log(`  Files updated:     ${result.filesUpdated.length}`);
  console.log(`  New utils:         ${result.newUtilitiesAvailable.length}`);
  console.log('');
}
