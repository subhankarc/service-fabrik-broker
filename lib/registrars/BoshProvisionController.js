const lib = require('../../lib');
const boshManager = lib.managers.boshManager;

boshManager.registerServices('director');
boshManager.registerWatcher();