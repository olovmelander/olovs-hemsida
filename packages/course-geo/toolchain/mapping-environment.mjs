/* The locked Python environment the intake and mapping tools run in (`pixi run -e mapping`).
   Tests that need it are skipped where it is not installed: CI installs the default environment only. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const local = path.join(os.homedir(), '.pixi/bin', process.platform === 'win32' ? 'pixi.exe' : 'pixi');
export const PIXI = fs.existsSync(local) ? local : 'pixi';
export const MAPPING_ENVIRONMENT = fs.existsSync(path.join(HERE, '.pixi/envs/mapping/conda-meta'));
export const NEEDS_MAPPING = MAPPING_ENVIRONMENT ? false : 'the Pixi mapping environment is not installed';
