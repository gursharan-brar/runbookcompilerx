// Usage: npm run record:previous-tag -- <currently-deployed-tag>
const fs = require('fs');
const path = require('path');

const tag = process.argv[2];
if (!tag) {
  console.error('usage: npm run record:previous-tag -- <tag>');
  process.exit(1);
}
const file = path.join(__dirname, '..', 'releases', 'PREVIOUS_TAG');
fs.writeFileSync(file, tag + '\n');
console.log(`recorded ${tag} in releases/PREVIOUS_TAG`);
