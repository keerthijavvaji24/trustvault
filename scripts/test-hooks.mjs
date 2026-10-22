import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'

const projectRoot = process.cwd()
const require = createRequire(import.meta.url)

export async function resolve(specifier, context, nextResolve) {
  let candidatePath = null

  if (specifier.startsWith('@/')) {
    candidatePath = path.join(projectRoot, specifier.slice(2))
  } else if (specifier.startsWith('./') || specifier.startsWith('../')) {
    if (context.parentURL) {
      const parentFile = fileURLToPath(context.parentURL)
      candidatePath = path.resolve(path.dirname(parentFile), specifier)
    }
  }

  if (candidatePath) {
    for (const ext of ['', '.ts', '.tsx', '.js', '/index.ts', '/index.js']) {
      const testPath = candidatePath + ext
      if (fs.existsSync(testPath) && fs.statSync(testPath).isFile()) {
        return {
          url: pathToFileURL(testPath).href,
          shortCircuit: true,
        }
      }
    }
  }

  if (specifier === 'next/headers') {
    return {
      url: pathToFileURL(require.resolve('next/headers')).href,
      shortCircuit: true,
    }
  }

  return nextResolve(specifier, context)
}
