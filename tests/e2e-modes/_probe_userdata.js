const { app } = require('electron');
app.whenReady().then(() => {
  console.log('USERDATA=' + app.getPath('userData'));
  console.log('NAME=' + app.getName());
  app.exit(0);
});
