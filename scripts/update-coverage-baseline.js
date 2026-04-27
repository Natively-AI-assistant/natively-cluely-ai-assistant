// scripts/update-coverage-baseline.js
/**
 * Updates the coverage baseline file with current coverage data.
 * Run: npm run coverage:update-baseline
 */
const fs = require('fs')
const path = require('path')

const coverageFile = path.join(__dirname, '..', 'coverage', 'coverage-final.json')
const baselineFile = path.join(__dirname, '..', 'coverage-baseline.json')

if (!fs.existsSync(coverageFile)) {
  console.error('Coverage file not found. Run `npm run test:coverage` first.')
  process.exit(1)
}

const coverage = JSON.parse(fs.readFileSync(coverageFile, 'utf8'))

// Calculate per-directory coverage
const directoryCoverage = {}
for (const [filePath, fileData] of Object.entries(coverage)) {
  const relPath = path.relative(path.join(__dirname, '..'), filePath)
  const dir = relPath.split(path.sep).slice(0, 2).join('/')

  if (!directoryCoverage[dir]) {
    directoryCoverage[dir] = { statements: 0, covered: 0 }
  }

  const stats = fileData
  const statementCounts = stats.s || {}
  for (const [id, count] of Object.entries(statementCounts)) {
    directoryCoverage[dir].statements++
    if (count > 0) {
      directoryCoverage[dir].covered++
    }
  }
}

// Calculate percentages
const result = {}
for (const [dir, data] of Object.entries(directoryCoverage)) {
  result[dir] = {
    lines: data.statements > 0 ? Math.round((data.covered / data.statements) * 100) : 0,
  }
}

fs.writeFileSync(baselineFile, JSON.stringify(result, null, 2))
console.log(`Coverage baseline updated: ${baselineFile}`)
console.log(JSON.stringify(result, null, 2))
