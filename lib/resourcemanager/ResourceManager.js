'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const logger = require('../logger');
const config = require('../config');
const CONST = require('../../lib/constants');

Promise.promisifyAll([require('node-etcd')]);
const Etcd = require('node-etcd');
const etcd = new Etcd(config.etcd.url);

class ResourceManager {
  constructor() {
    logger.info('ETCD url details : ', config.etcd.url);
  }

  createResource(resourceType, resourceId, value) {
    const resourceFolderName = `deployments/${resourceType}/${resourceId}`;
    const optionKey = `${resourceFolderName}/options`;
    return etcd.setAsync(optionKey, value)
      .then(() => {
        const statusKey = `${resourceFolderName}/state`;
        logger.info(`Resource Created for ${statusKey}`);
        return etcd.setAsync(statusKey, CONST.RESOURCE_STATE.IN_QUEUE);
      }).tap(() => {
        logger.info('Resource Status is set');
      });
  }

  updateResourceState(resourceType, resourceId, stateValue) {
    const resourceFolderName = `deployments/${resourceType}/${resourceId}`;
    const statusKey = `${resourceFolderName}/state`;
    return etcd.setAsync(statusKey, stateValue);
  }

  updateResourceKey(resourceType, resourceId, key, value) {
    const resourceFolderName = `deployments/${resourceType}/${resourceId}`;
    const statusKey = `${resourceFolderName}/${key}`;
    return etcd.setAsync(statusKey, value);
  }

  getResourceKey(resourceType, resourceId, key) {
    const resourceFolderName = `deployments/${resourceType}/${resourceId}`;
    const statusKey = `${resourceFolderName}/${key}`;
    logger.info(`HELLO!!!!!!!!!!!!!! Getting resource key for ${statusKey}`);
    return etcd.getAsync(statusKey).then(statusNode => {
      return statusNode.node.value;
    });
  }

  getResourceState(resourceType, resourceId) {
    const resourceFolderName = `deployments/${resourceType}/${resourceId}`;
    const statusKey = `${resourceFolderName}/state`;
    logger.info(`Getting resource status for ${statusKey}`);
    return etcd.getAsync(statusKey).then(statusNode => {
      return statusNode.node.value;
    });
  }

  registerWatcher(key, callback, isRecursive) {
    const watcher = etcd.watcher(key, null, {
      recursive: isRecursive
    });
    logger.info('watcher is registered for : ', key);
    watcher.on("change", callback);
  }

}

module.exports = ResourceManager;