'use strict';

const BOSHManager = require('./bosh-manager/BOSHManager');
const BOSHTaskpoller = require('./bosh-manager/BOSHTaskpoller');

BOSHTaskpoller.start();
const boshManager = new BOSHManager();
boshManager.init();