'use strict';

const K8sManager = require('./k8s-manager/K8sManager');
const K8sBindManager = require('./k8s-manager/K8sBindManager');
const K8sTaskPoller = require('./k8s-manager/K8sTaskPoller');

K8sTaskPoller.start();
const k8sManager = new K8sManager();
const bindManager = new K8sBindManager();
k8sManager.init();
bindManager.init();