const DefaultBackupManager = require('./operation/DefaultBackupManager');
let defaultBackupManager = new DefaultBackupManager();
defaultBackupManager.registerWatcher();