/**
 * Code Generator
 * Generates entities, repositories, services, and controllers from specifications
 */

import * as fs from 'fs';
import * as path from 'path';
import Handlebars from 'handlebars';
import { EntitySpecification, GeneratorConfig, TemplateContext } from './types';
import { parseEntitySpecification } from './parser';

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

/**
 * Code Generator Class
 */
export class CodeGenerator {
  private templatesDir: string;
  private outputDir: string;

  constructor(templatesDir: string, outputDir: string) {
    this.templatesDir = templatesDir;
    this.outputDir = outputDir;
  }

  /**
   * Generate all code for an entity
   */
  async generateEntity(
    entityName: string,
    spec: EntitySpecification,
    config: Partial<GeneratorConfig> = {}
  ): Promise<void> {
    const context = parseEntitySpecification(
      entityName,
      spec,
      config.collectionName
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
  }

  /**
   * Generate from a template file
   */
  private async generateFromTemplate(
    templateName: string,
    context: TemplateContext,
    outputPath: string
  ): Promise<void> {
    // Read template
    const templatePath = path.join(this.templatesDir, `${templateName}.hbs`);
    const templateContent = fs.readFileSync(templatePath, 'utf-8');

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
      const exports = files.map((f) => {
        const name = f.replace('.ts', '');
        return `export * from './${name}';`;
      });

      const indexPath = path.join(dir, 'index.ts');
      fs.writeFileSync(indexPath, exports.join('\n') + '\n', 'utf-8');
    }

    console.log('✅ Generated barrel exports');
  }
}

/**
 * Helper function to create generator instance
 */
export function createGenerator(outputDir?: string): CodeGenerator {
  const templatesDir = path.join(__dirname, '../templates');
  const output = outputDir || path.join(__dirname, '../generated');

  return new CodeGenerator(templatesDir, output);
}
