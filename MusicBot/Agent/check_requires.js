const fs = require('fs');
const path = require('path');

function getFiles(dir) {
    const subdirs = fs.readdirSync(dir);
    const files = subdirs.map((subdir) => {
        const res = path.resolve(dir, subdir);
        return fs.statSync(res).isDirectory() ? getFiles(res) : res;
    });
    return files.reduce((a, f) => a.concat(f), []);
}

const jsFiles = [...getFiles(path.resolve(__dirname, '../src/player')), ...getFiles(path.resolve(__dirname, '../src/bootstrap'))].filter(f => f.endsWith('.js'));

let hasErrors = false;
for (const file of jsFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const regex = /require\(['"](.+?)['"]\)/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
        const reqPath = match[1];
        if (reqPath.startsWith('.')) {
            try {
                require.resolve(reqPath, { paths: [path.dirname(file)] });
            } catch (e) {
                console.error(`Broken require in ${file} -> ${reqPath}`);
                hasErrors = true;
            }
        }
    }
}
if (!hasErrors) {
    console.log('All internal requires are valid.');
} else {
    process.exit(1);
}
