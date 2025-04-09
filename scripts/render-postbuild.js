const fs = require('fs');
const path = require('path');

// Create necessary directories
const dirs = ['exports', 'logs'];

dirs.forEach(dir => {
  const dirPath = path.join(process.cwd(), dir);
  if (!fs.existsSync(dirPath)) {
    console.log(`Creating ${dir} directory...`);
    fs.mkdirSync(dirPath, { recursive: true });
  }
});

console.log('Post-build setup completed');
