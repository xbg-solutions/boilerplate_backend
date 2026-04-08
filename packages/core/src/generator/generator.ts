/**
 * Code Generator
 * Generates entities, repositories, services, and controllers from specifications
 */

import * as fs from 'fs';
import * as path from 'path';
import Handlebars from 'handlebars';
import { EntitySpecification, GeneratorConfig, TemplateContext } from './types';
import { parseEntitySpecification } from './parser';
import { getTemplate } from './templates';

/**
 * Register Handlebars helpers
 */
Handlebars.registerHelper('capitalize', (str: string) => {
  return str.charAt(0).toUpperCase() + str.slice(1);
});

Handlebars.registerHelper('lowercase', (str: string) => {
  return str.toLowerCase();
});

Handlebars.registerHelper('uppercase', (str: string) => {
  return str.toUpperCase();
});

Handlebars.registerHelper('ifEquals', function (this: any, a: any, b: any, options: any) {
  return a === b ? options.fn(this) : options.inverse(this);
});

/**
 * Code Generator Class
 */
export class CodeGenerator {
  private outputDir: string;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
  }

  /**
   * Generate all code for an entity.
   * Returns the TemplateContext so callers can collect contexts
   * for encryption registry generation.
   */
  async generateEntity(
    entityName: string,
    spec: EntitySpecification,
    config: Partial<GeneratorConfig> = {},
    allEntities?: Record<string, EntitySpecification>
  ): Promise<TemplateContext> {
    const context = parseEntitySpecification(
      entityName,
      spec,
      config.collectionName,
      allEntities
    );

    // Ensure output directories exist
    this.ensureDirectories();

    // Generate entity
    await this.generateFromTemplate('entity', context, `entities/${entityName}.ts`);

    // Generate repository
    await this.generateFromTemplate('repository', context, `repositories/${entityName}Repository.ts`);

    // Generate service
    await this.generateFromTemplate('service', context, `services/${entityName}Service.ts`);

    // Generate controller
    await this.generateFromTemplate('controller', context, `controllers/${entityName}Controller.ts`);

    // Generate tests if requested
    if (config.generateTests) {
      await this.generateTests(context);
    }

    console.log(`✅ Generated code for ${entityName}`);
    return context;
  }

  /**
   * Generate from an embedded template
   */
  private async generateFromTemplate(
    templateName: string,
    context: TemplateContext,
    outputPath: string
  ): Promise<void> {
    // Get embedded template content
    const templateContent = getTemplate(templateName);

    // Compile template
    const template = Handlebars.compile(templateContent);

    // Generate code
    const code = template(context);

    // Write to file
    const fullOutputPath = path.join(this.outputDir, outputPath);
    fs.writeFileSync(fullOutputPath, code, 'utf-8');
  }

  /**
   * Generate tests
   */
  private async generateTests(context: TemplateContext): Promise<void> {
    // TODO: Implement test generation
    console.log(`  - Tests for ${context.entityName} (not implemented yet)`);
  }

  /**
   * Ensure output directories exist
   */
  private ensureDirectories(): void {
    const dirs = [
      path.join(this.outputDir, 'entities'),
      path.join(this.outputDir, 'repositories'),
      path.join(this.outputDir, 'services'),
      path.join(this.outputDir, 'controllers'),
      path.join(this.outputDir, 'tests'),
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * Generate barrel exports
   */
  async generateBarrelExports(): Promise<void> {
    const categories = ['entities', 'repositories', 'services', 'controllers'];

    for (const category of categories) {
      const dir = path.join(this.outputDir, category);

      if (!fs.existsSync(dir)) {
        continue;
      }

      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');
      const allExports = new Set(
        files.map((f) => `export * from './${f.replace('.ts', '')}';`)
      );

      // Merge with existing barrel exports (preserves hand-added lines)
      const indexPath = path.join(dir, 'index.ts');
      if (fs.existsSync(indexPath)) {
        const existing = fs.readFileSync(indexPath, 'utf-8');
        existing
          .split('\n')
          .filter((line) => line.startsWith('export '))
          .forEach((line) => allExports.add(line));
      }

      const sorted = [...allExports].sort();
      fs.writeFileSync(indexPath, sorted.join('\n') + '\n', 'utf-8');
    }

    console.log('✅ Generated barrel exports');
  }

  /**
   * Generate encryption registry file from collected template contexts.
   * Produces a startup registration file that calls registerHashedFields()
   * for each entity with encrypted fields.
   *
   * Call this after all generateEntity() calls, passing the collected contexts.
   */
  async generateEncryptionRegistry(contexts: TemplateContext[]): Promise<void> {
    const encrypted = contexts.filter((c) => c.hasEncryption);
    if (encrypted.length === 0) return;

    const lines: string[] = [
      "/**",
      " * Encryption Registry — Auto-generated",
      " * Call registerEncryptedFields() at app startup before any read/write operations.",
      " */",
      "",
      "import { registerHashedFields } from '@xbg.solutions/utils-hashing';",
      "",
      "export function registerEncryptedFields(): void {",
    ];

    for (const ctx of encrypted) {
      if (ctx.transparentFields.length > 0) {
        const fields = ctx.transparentFields.map((f) => `'${f}'`).join(', ');
        lines.push(`  registerHashedFields('${ctx.entityNameLower}', [${fields}], 'transparent');`);
      }
      if (ctx.guardedFields.length > 0) {
        const fields = ctx.guardedFields.map((f) => `'${f}'`).join(', ');
        lines.push(`  registerHashedFields('${ctx.entityNameLower}', [${fields}], 'guarded');`);
      }
    }

    lines.push("}");
    lines.push("");

    const outputPath = path.join(this.outputDir, 'encryption-registry.ts');
    fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
    console.log('✅ Generated encryption registry');
  }
}

/**
 * Helper function to create generator instance
 */
export function createGenerator(outputDir?: string): CodeGenerator {
  const output = outputDir || path.join(__dirname, '../generated');
  return new CodeGenerator(output);
}
