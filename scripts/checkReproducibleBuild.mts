/**
 * Builds each package several times with randomized module-resolution timing and fails if
 * the outputs differ. Yarn installs these packages from git by building them on the
 * consumer's machine, so a non-reproducible build breaks the consumer's lockfile checksum.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { setTimeout } from 'node:timers/promises'
import { build } from 'vite'
import type { Plugin } from 'vite'

// history's type declarations are built against core's dist, so core goes first
const PACKAGE_DIRECTORIES = ['packages/base/core', 'packages/history/history']
const BUILDS_PER_PACKAGE = 3
const MAX_RESOLVE_DELAY_MS = 15

/**
 * Delays every module resolution by a random amount, so that output depending on
 * resolution order shows up as a difference between builds.
 */
const resolveJitter: Plugin = {
  name: 'resolve-jitter',
  enforce: 'pre',
  async resolveId() {
    await setTimeout(Math.random() * MAX_RESOLVE_DELAY_MS)
    return null
  },
}

/**
 * Hashes every file below a directory.
 * @param directory directory to hash
 * @returns sha256 hash of each file, keyed by its path relative to `directory`
 */
function hashFiles(directory: string) {
  const files = fs.readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => path.relative(directory, path.join(entry.parentPath, entry.name)))
    .toSorted()
  return new Map(files.map((file): [string, string] => [
    file,
    createHash('sha256').update(fs.readFileSync(path.join(directory, file))).digest('hex'),
  ]))
}

/**
 * Lists the files whose presence or content differs between two hashed outputs.
 * @param first hashes of the first output
 * @param second hashes of the second output
 * @returns paths of the differing files
 */
function differingFiles(first: Map<string, string>, second: Map<string, string>) {
  const allFiles = new Set([...first.keys(), ...second.keys()])
  return [...allFiles].filter(file => first.get(file) !== second.get(file))
}

const repositoryRoot = process.cwd()
let isReproducible = true

for (const packageDirectory of PACKAGE_DIRECTORIES) {
  const packageRoot = path.resolve(repositoryRoot, packageDirectory)
  // @rollup/plugin-typescript resolves tsconfig and outDir from the working directory
  process.chdir(packageRoot)

  const outputs: Map<string, string>[] = []
  for (let buildIndex = 0; buildIndex < BUILDS_PER_PACKAGE; buildIndex += 1) {
    await build({ root: packageRoot, logLevel: 'silent', plugins: [resolveJitter] })
    outputs.push(hashFiles(path.join(packageRoot, 'dist')))
  }

  const [firstOutput, ...laterOutputs] = outputs
  const differences = new Set(laterOutputs.flatMap(output => differingFiles(firstOutput, output)))
  if (differences.size > 0) {
    isReproducible = false
    process.stderr.write(`${packageDirectory}: build output differs between builds in:\n`)
    for (const file of [...differences].toSorted()) process.stderr.write(`  ${file}\n`)
  } else {
    process.stdout.write(`${packageDirectory}: ${BUILDS_PER_PACKAGE} builds produced identical output\n`)
  }
}

process.chdir(repositoryRoot)
process.exitCode = isReproducible ? 0 : 1
