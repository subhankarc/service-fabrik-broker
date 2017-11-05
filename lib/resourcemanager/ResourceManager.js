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

  //##########################################
  //###########Resource API###################
  //##########################################
  createResource(resourceType, resourceId, value) {
    const resourceFolderName = `deployments/${resourceType}/${resourceId}`;
    const optionKey = `${resourceFolderName}/options`;
    return etcd.setAsync(optionKey, value)
      .then(() => {
        const statusKey = `${resourceFolderName}/state`;
        return etcd.setAsync(statusKey, CONST.RESOURCE_STATE.IN_QUEUE);
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
    return etcd.getAsync(statusKey).then(statusNode => {
      return statusNode.node.value;
    });
  }

  getResourceState(resourceType, resourceId) {
    const resourceFolderName = `deployments/${resourceType}/${resourceId}`;
    const statusKey = `${resourceFolderName}/state`;
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

  //##########################################
  //###########Annotation API#################
  //##########################################

  annotateResource(resourceType, resourceId, annotationName, operationType, opId, value) {
    const annotationFolderName = `deployments/${resourceType}/${resourceId}/${annotationName}/${operationType}/${opId}`;
    const optionKey = `${annotationFolderName}/options`;
    return etcd.setAsync(optionKey, value)
      .then(() => {
        const statusKey = `${annotationFolderName}/state`;
        return etcd.setAsync(statusKey, CONST.RESOURCE_STATE.IN_QUEUE);
      });
  }

  updateAnnotationState(resourceType, resourceId, annotationName, operationType, opId, stateValue) {
    const annotationFolderName = `deployments/${resourceType}/${resourceId}/${annotationName}/${operationType}/${opId}`;
    const statusKey = `${annotationFolderName}/state`;
    return etcd.setAsync(statusKey, stateValue);
  }

  updateAnnotationKey(resourceType, resourceId, annotationName, operationType, opId, key, value) {
    const annotationFolderName = `deployments/${resourceType}/${resourceId}/${annotationName}/${operationType}/${opId}`;
    const statusKey = `${annotationFolderName}/${key}`;
    return etcd.setAsync(statusKey, value);
  }

  getAnnotationKey(resourceType, resourceId, annotationName, operationType, opId, key) {
    const annotationFolderName = `deployments/${resourceType}/${resourceId}/${annotationName}/${operationType}/${opId}`;
    const statusKey = `${annotationFolderName}/${key}`;
    return etcd.getAsync(statusKey).then(statusNode => {
      return statusNode.node.value;
    });
  }

  getAnnotationState(resourceType, resourceId, annotationName, operationType, opId) {
    const annotationFolderName = `deployments/${resourceType}/${resourceId}/${annotationName}/${operationType}/${opId}`;
    const statusKey = `${annotationFolderName}/state`;
    return etcd.getAsync(statusKey).then(statusNode => {
      return statusNode.node.value;
    });
  }


}

module.exports = ResourceManager;