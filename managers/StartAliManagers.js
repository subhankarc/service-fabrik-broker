'use strict';

const AliManager = require('./alicloud-manager/AliManager');
const AliBindManager = require('./alicloud-manager/AliBindManager');
const AliTaskPoller = require('./alicloud-manager/AliTaskPoller');

AliTaskPoller.start();
const aliManager = new AliManager();
const bindManager = new AliBindManager();
aliManager.init();
bindManager.init();