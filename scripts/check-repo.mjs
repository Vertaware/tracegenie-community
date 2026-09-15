import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const failures = [];
const suffixes = ['', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '/index.ts', '/index.tsx', '/index.js'];
function resolves(base) {
  // Shared tests import compiled modules; their source is authoritative before the first build.
  const alternatives = [base, base.replace(/\.js$/, '.ts'), base.replace(/\/dist\//, '/src/').replace(/\.js$/, '.ts')];
  return alternatives.some(candidate => suffixes.some(suffix => fs.existsSync(candidate + suffix) && fs.statSync(candidate + suffix).isFile()));
}
for (const file of files) {
  if (/(^|\/)(node_modules|dist|\.local|coverage|test-results|playwright-report|backups)(\/|$)/.test(file) || /(^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.env.example') || file.startsWith('apps/api/uploads/')) {
    failures.push(`${file}: private or generated artifact in shareable files`);
    continue;
  }
  if (!/\.(?:tsx?|[cm]?jsx?)$/.test(file) || !fs.existsSync(path.join(root, file))) continue;
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  function visit(node) {
    let specifier;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifier = node.moduleSpecifier.text;
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === 'require') && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) specifier = node.arguments[0].text;
    if (specifier?.startsWith('.')) {
      const target = path.resolve(root, path.dirname(file), specifier.split('?')[0]);
      if (!resolves(target)) failures.push(`${file}: missing relative module ${specifier}`);
    }
    if (ts.isDebuggerStatement(node)) failures.push(`${file}: debugger statement`);
    ts.forEachChild(node, visit);
  }
  visit(source);
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Repository hygiene passed for ${files.length} shareable files.`);
}
