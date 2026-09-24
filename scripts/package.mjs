#!/usr/bin/env node
/**
 * Genera dist-release/ listo para copiar al Windows Server.
 * No incluye .env ni secretos. No hace deploy.
 */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const outDir = join(root, 'dist-release');

const CLI = [
  'db:test',
  'db:tables',
  'db:columns',
  'db:relations',
  'db:search',
  'db:sample',
  'discovery',
  'sync:products',
  'sync:stock',
  'sync:prices',
  'sync:clients',
  'sync:dictionaries',
  'sync:full',
  'sync:incremental',
  'queue:status',
  'queue:drain',
];

console.log('Compilando (npm run build)...');
execSync('npm run build', { stdio: 'inherit', cwd: root });

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const copies = [
  ['dist', 'dist'],
  ['scripts', 'scripts'],
  ['docs', 'docs'],
  ['config/mapping.example.json', 'config/mapping.example.json'],
  ['.env.example', '.env.example'],
  ['package-lock.json', 'package-lock.json'],
];
for (const [src, dest] of copies) {
  const srcPath = join(root, src);
  if (!existsSync(srcPath)) {
    console.warn(`  (omitido, no existe) ${src}`);
    continue;
  }
  cpSync(srcPath, join(outDir, dest), { recursive: true });
}

const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const scripts = {
  start: 'node dist/index.js',
  run: 'node dist/index.js run',
  'service:install': 'powershell -ExecutionPolicy Bypass -File scripts/install-service.ps1',
  'service:uninstall': 'powershell -ExecutionPolicy Bypass -File scripts/uninstall-service.ps1',
  'service:start': 'powershell -ExecutionPolicy Bypass -File scripts/start-service.ps1',
  'service:stop': 'powershell -ExecutionPolicy Bypass -File scripts/stop-service.ps1',
  'service:restart': 'powershell -ExecutionPolicy Bypass -File scripts/restart-service.ps1',
  'service:status': 'powershell -ExecutionPolicy Bypass -File scripts/status-service.ps1',
};
for (const name of CLI) {
  const target = name.replace(':', ' ');
  scripts[name] = `node dist/index.js ${target}`;
}

const releasePkg = {
  name: rootPkg.name,
  version: rootPkg.version,
  private: true,
  description: rootPkg.description,
  license: rootPkg.license,
  engines: rootPkg.engines,
  main: rootPkg.main,
  scripts,
  dependencies: rootPkg.dependencies,
};
writeFileSync(join(outDir, 'package.json'), `${JSON.stringify(releasePkg, null, 2)}\n`);

mkdirSync(join(outDir, 'data'), { recursive: true });
mkdirSync(join(outDir, 'logs'), { recursive: true });

const installText = `NavaSoft Connector - Instalacion (Windows Server 2016)
=======================================================

Requisitos:
  - Node.js LTS (>=18) instalado y en PATH.
  - NSSM (https://nssm.cc/download) para instalar como servicio.
  - Acceso a la replica SQL Server (READ ONLY).

Pasos:
  1) Copiar esta carpeta al servidor (ej: C:\\NavaSoftConnector).
  2) Abrir PowerShell como Administrador en la carpeta.
  3) cd C:\\NavaSoftConnector
  4) copy .env.example .env
  5) Editar .env con las credenciales SQL y de la API (NO commitear .env).
  6) npm ci --omit=dev
  7) npm run db:test
  8) npm run discovery
  9) Revisar docs/discovery-report.md y crear config/mapping.json
 10) npm run sync:full --dry-run   (verificar)
 11) npm run service:install

Notas:
  - El connector NO necesita puertos entrantes. Solo HTTPS saliente.
  - No usar git pull en el servidor: copiar el artefacto compilado.
  - Logs en logs/. Estado local en data/.
`;

writeFileSync(join(outDir, 'README-INSTALL.txt'), installText);

console.log(`\nRelease generado en: ${outDir}`);
console.log(
  'Contenido: dist/, scripts/, docs/, config/mapping.example.json, .env.example, README-INSTALL.txt',
);
