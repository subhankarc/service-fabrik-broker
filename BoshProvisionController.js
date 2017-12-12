const lib = require('./lib');
const directorProvisioner = lib.managers.directorProvisioner;

directorProvisioner.registerServices('director');
directorProvisioner.registerWatcher();