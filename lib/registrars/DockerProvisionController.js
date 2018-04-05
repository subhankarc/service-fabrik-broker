const lib = require('../lib');
const dockerManager = lib.managers.dockerManager;

dockerManager.registerServices('docker');
dockerManager.registerWatcher();