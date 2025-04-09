const fs = require('fs');
const path = require('path');
const os = require('os');

const exportDir = path.resolve(process.cwd(), 'exports');
console.log(`Checking exports directory: ${exportDir}`);

try {
    if (!fs.existsSync(exportDir)) {
        console.log('Creating exports directory...');
        fs.mkdirSync(exportDir, { recursive: true });
        console.log('Exports directory created successfully');
    } else {
        console.log('Exports directory already exists');
        
        try {
            // Test write permission by creating and removing a test file
            const testFile = path.join(exportDir, '.test-write');
            fs.writeFileSync(testFile, 'test');
            fs.unlinkSync(testFile);
            console.log('Write permission confirmed on exports directory');
        } catch (writeError) {
            console.error('WARNING: Cannot write to exports directory:', writeError.message);
            console.log('Fixing permissions...');
            
            try {
                // For UNIX systems only
                if (os.platform() !== 'win32') {
                    require('child_process').execSync(`chmod -R 777 "${exportDir}"`);
                    console.log('Permissions updated');
                } else {
                    console.log('On Windows, please ensure the exports directory has write permissions');
                }
            } catch (chmodError) {
                console.error('Error updating permissions:', chmodError.message);
            }
        }
    }

    // List files in the exports directory
    const files = fs.readdirSync(exportDir);
    console.log(`Files in exports directory (${files.length}):`);
    files.forEach((file, index) => {
        const stats = fs.statSync(path.join(exportDir, file));
        console.log(`${index + 1}. ${file} - ${(stats.size / 1024).toFixed(2)} KB`);
    });
} catch (error) {
    console.error('Error ensuring exports directory:', error);
}
