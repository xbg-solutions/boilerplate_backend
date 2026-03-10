/**
 * Add Utility Command
 * Adds a utility package to an existing project
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { getOptionalUtilities, UTILITY_REGISTRY } from '../utils-registry';

interface AddUtilOptions {
  directory: string;
}

export async function addUtility(options: AddUtilOptions): Promise<void> {
  const projectDir = path.resolve(options.directory);
  const functionsDir = path.join(projectDir, 'functions');
  const pkgJsonPath = path.join(functionsDir, 'package.json');

  // Verify project exists
  if (!await fs.pathExists(pkgJsonPath)) {
    console.error(chalk.red('Not an XBG backend project. Run from the project root.'));
    process.exit(1);
  }

  console.log(chalk.bold.blue('\n── Add Utility ─────────────────────────────────\n'));

  const pkgJson = await fs.readJson(pkgJsonPath);
  const installedDeps = Object.keys(pkgJson.dependencies || {});

  // Get utilities not yet installed
  const optionalUtils = getOptionalUtilities();
  const notInstalled = optionalUtils.filter((u) => !installedDeps.includes(u.package));

  if (notInstalled.length === 0) {
    console.log(chalk.green('All available utilities are already installed!'));
    return;
  }

  // Group by category
  const categories = [...new Set(notInstalled.map((u) => u.category))];
  const choices = categories.flatMap((category) => {
    const categoryUtils = notInstalled.filter((u) => u.category === category);
    return [
      new inquirer.Separator(`── ${category.toUpperCase()} ──`),
      ...categoryUtils.map((u) => ({
        name: `${u.name} - ${chalk.dim(u.description)}`,
        value: u.package,
      })),
    ];
  });

  const { selected } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selected',
      message: 'Select utilities to add:',
      choices,
      pageSize: 20,
    },
  ]);

  if ((selected as string[]).length === 0) {
    console.log(chalk.dim('No utilities selected.'));
    return;
  }

  // Install packages
  const packages = (selected as string[]).join(' ');
  console.log(chalk.cyan(`\nInstalling: ${packages}\n`));

  try {
    execSync(`npm install ${packages}`, { cwd: functionsDir, stdio: 'inherit' });
    console.log(chalk.green('\nUtilities installed successfully!'));

    // Show env vars that may need configuration
    const addedUtils = (selected as string[])
      .map((pkg) => UTILITY_REGISTRY.find((u) => u.package === pkg))
      .filter(Boolean);

    const envVars = addedUtils
      .flatMap((u) => u?.envVars || [])
      .filter(Boolean);

    if (envVars.length > 0) {
      console.log(chalk.yellow('\nEnvironment variables you may need to configure in functions/.env:'));
      for (const envVar of envVars) {
        console.log(chalk.dim(`  ${envVar}=`));
      }
    }
  } catch {
    console.error(chalk.red('Failed to install. Try running npm install manually.'));
    process.exit(1);
  }
}
