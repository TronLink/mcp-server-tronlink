import { exec } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BuildCapability, BuildOptions, BuildResult } from '@tronlink/mcp-core';

/**
 * Build capability for TronLink extension.
 * Runs the webpack build from the extension source directory.
 */
export class TronLinkBuildCapability implements BuildCapability {
  private extensionSourcePath: string;
  private outputPath: string;

  constructor(extensionSourcePath: string, outputPath?: string) {
    this.extensionSourcePath = extensionSourcePath;
    this.outputPath = outputPath || path.join(extensionSourcePath, 'dist');
  }

  async build(options?: BuildOptions): Promise<BuildResult> {
    const startTime = Date.now();

    const buildCmd =
      options?.mode === 'production'
        ? 'npm run build:prd:chrome'
        : options?.mv2
          ? 'npm run build:mv2'
          : 'npm run build';

    return new Promise((resolve) => {
      exec(
        buildCmd,
        { cwd: this.extensionSourcePath, timeout: 300_000 },
        (error, _stdout, stderr) => {
          const durationMs = Date.now() - startTime;

          if (error) {
            resolve({
              success: false,
              extensionPath: this.outputPath,
              durationMs,
              error: stderr || error.message,
            });
          } else {
            resolve({
              success: true,
              extensionPath: this.outputPath,
              durationMs,
            });
          }
        },
      );
    });
  }

  getExtensionPath(): string {
    return this.outputPath;
  }

  async isBuilt(): Promise<boolean> {
    try {
      const manifestPath = path.join(this.outputPath, 'manifest.json');
      return fs.existsSync(manifestPath);
    } catch {
      return false;
    }
  }
}
