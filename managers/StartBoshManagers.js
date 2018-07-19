'use strict';

const BOSHManager = require('./bosh-manager/BOSHManager');
const BindManager = require('./bosh-manager/BindManager');
const BOSHTaskpoller = require('./bosh-manager/BOSHTaskpoller');

BOSHTaskpoller.start();
const boshManager = new BOSHManager();
const bindManager = new BindManager();
boshManager.init();
bindManager.init();