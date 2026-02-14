const electronModule = require('electron');
console.log('Type of electron module:', typeof electronModule);
console.log('Electron module is string?:', typeof electronModule === 'string');
console.log('Electron module value:', electronModule);

if (typeof electronModule === 'string') {
  console.log('\n❌ ERROR: electron module returned a string (path) instead of the API');
  console.log('This means Electron is not properly intercepting the require() call');
  process.exit(1);
}

console.log('\n✅ Electron module loaded correctly');
console.log('Available exports:', Object.keys(electronModule).slice(0, 20));
