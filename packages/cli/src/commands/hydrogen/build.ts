import path from 'path';
import * as esbuild from 'esbuild';
import * as remix from '@remix-run/dev/dist/compiler.js';
import fsExtra from 'fs-extra';
import {getProjectPaths, getRemixConfig} from '../../utils/config.js';
import {flags} from '../../utils/flags.js';

import Command from '@shopify/cli-kit/node/base-command';
import {Flags} from '@oclif/core';

// @ts-ignore
export default class Build extends Command {
  static description = 'Builds a Hydrogen storefront for production';
  static flags = {
    ...flags,
    sourcemap: Flags.boolean({
      env: 'SHOPIFY_HYDROGEN_FLAG_SOURCEMAP',
    }),
    entry: Flags.string({
      env: 'SHOPIFY_HYDROGEN_FLAG_SOURCEMAP',
      default: 'oxygen.ts',
    }),
    minify: Flags.boolean({
      description: 'Minify the build output',
      env: 'SHOPIFY_HYDROGEN_FLAG_MINIFY',
    }),
  };

  async run(): Promise<void> {
    // @ts-ignore
    const {flags} = await this.parse(Build);
    const directory = flags.path ? path.resolve(flags.path) : process.cwd();

    await runBuild({...flags, path: directory});
  }
}

export async function runBuild({
  entry,
  workerOnly = false,
  minify = !workerOnly,
  sourcemap = true,
  path: appPath,
}: {
  entry: string;
  workerOnly?: boolean;
  sourcemap?: boolean;
  minify?: boolean;
  path?: string;
}) {
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = workerOnly ? 'development' : 'production';
  }

  const {
    root,
    entryFile,
    buildPath,
    buildPathClient,
    buildPathWorkerFile,
    publicPath,
  } = getProjectPaths(appPath, entry);

  if (!workerOnly) {
    const remixConfig = await getRemixConfig(root);
    await fsExtra.rm(buildPath, {force: true, recursive: true});

    // eslint-disable-next-line no-console
    console.log(`Building app in ${process.env.NODE_ENV} mode...`);

    await remix.build(remixConfig, {
      mode: process.env.NODE_ENV as any,
      sourcemap,
      onBuildFailure: (failure: Error) => {
        remix.formatBuildFailure(failure);
        // Stop here and prevent waterfall errors
        throw Error();
      },
    });
  }

  await Promise.all([
    fsExtra.copy(publicPath, buildPathClient, {
      recursive: true,
      overwrite: true,
    }),
    esbuild.build({
      entryPoints: [entryFile],
      bundle: true,
      outfile: buildPathWorkerFile,
      format: 'esm',
      define: {
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
      },
      sourcemap,
      minify,
      incremental: workerOnly,
      conditions: ['worker', process.env.NODE_ENV],
    }),
  ]);

  if (process.env.NODE_ENV !== 'development') {
    const {size} = await fsExtra.stat(buildPathWorkerFile);
    const sizeMB = size / (1024 * 1024);

    // eslint-disable-next-line no-console
    console.log(
      '\n' + path.relative(root, buildPathWorkerFile),
      '  ',
      Number(sizeMB.toFixed(2)),
      'MB',
    );

    if (sizeMB >= 1) {
      // eslint-disable-next-line no-console
      console.warn(
        '\n-- Worker bundle exceeds 1 MB! This can delay your worker response.',
      );
    }
  }
}
