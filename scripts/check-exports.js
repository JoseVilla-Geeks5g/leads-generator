const fs = require('fs');
const path = require('path');

// Check exports directory
const exportDir = path.resolve(process.cwd(), 'exports');
console.log(`Checking exports directory: ${exportDir}`);

// Create directory if it doesn't exist
if (!fs.existsSync(exportDir)) {
    console.log('Directory does not exist, creating it now');
    fs.mkdirSync(exportDir, { recursive: true });
    console.log('Created exports directory');
} else {
    console.log('Exports directory exists');
    
    // List files in the directory
    const files = fs.readdirSync(exportDir);
    console.log(`Found ${files.length} files in exports directory:`);
    
    files.forEach(file => {
        const stats = fs.statSync(path.join(exportDir, file));
        console.log(`- ${file} (${(stats.size / 1024).toFixed(2)}KB) - Modified: ${stats.mtime}`);
    });
}

console.log('Export directory check complete');
