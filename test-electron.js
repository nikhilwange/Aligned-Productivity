const { app } = require('electron');
console.log('✅ App loaded successfully:', typeof app);
console.log('✅ App.whenReady exists:', typeof app.whenReady);
app.whenReady().then(() => {
  console.log('✅ Electron is ready!');
  app.quit();
});
