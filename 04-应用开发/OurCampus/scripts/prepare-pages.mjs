import { rm } from 'node:fs/promises'

const unusedCampusModel = new URL('../dist/assets/sxau-campus-extracted.glb', import.meta.url)

await rm(unusedCampusModel, { force: true })
console.log('Excluded unused sxau-campus-extracted.glb from the Pages deployment.')
