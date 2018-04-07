'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const config = require('../config');
const logger = require('../logger');
const CONST = require('../../lib/constants');

const {
  Etcd3
} = require('etcd3');
const etcd = new Etcd3({
  hosts: config.etcd.url[0]
});

class Etcd3EventMeshServer {

  registerServices(resourceType, serviceId, serviceAttributesValue, servicePlansValue) {
    const serviceFolderName = `services/${resourceType}/${serviceId}`;
    const optionKey = `${serviceFolderName}/attributes`;
    return etcd.put(optionKey).value(JSON.stringify(serviceAttributesValue))
      .then(() => {
        const plansKey = `${serviceFolderName}/plans`;
        return etcd.put(plansKey).value(JSON.stringify(servicePlansValue));
      });
  }

  getServiceAttributes(resourceType, serviceId) {
    const resourceFolderName = `services/${resourceType}/${serviceId}`;
    const attrKey = `${resourceFolderName}/attributes`;
    return etcd.get(attrKey).json()
  }

  getServicePlans(resourceType, serviceId) {
    const resourceFolderName = `services/${resourceType}/${serviceId}`;
    const attrKey = `${resourceFolderName}/plans`;
    return etcd.get(attrKey).json();
  }

  getAllServices() {
    // array within array logic
    return Promise.try(() => {});
  }

  createResource(resourceType, resourceId, val) {
    const resourceFolderName = `deployments/${resourceType}/${resourceId}`;
    const optionKey = `${resourceFolderName}/options`;
    const statusKey = `${resourceFolderName}/state`;
    const lastOperationKey = `${resourceFolderName}/lastoperation`;
    const backuplock = `${resourceFolderName}/backuplock`;
    const updatelock = `${resourceFolderName}/updatelock`;
    const updatelockdetails = `${resourceFolderName}/updatelockdetails`;
    const backuplockdetails = `${resourceFolderName}/backuplockdetails`;
    const restorelock = `${resourceFolderName}/restorelock`;
    const restorelockdetails = `${resourceFolderName}/restorelockdetails`;
    logger.info('etcd3 optionKey', optionKey)
    logger.info('etcd3 statusKey', statusKey)
    logger.info('etcd3 lastOperationKey', lastOperationKey)

    return etcd.put(optionKey).value(val)
      .then(() => etcd.put(statusKey).value(CONST.RESOURCE_STATE.IN_QUEUE))
      .then(() => etcd.put(lastOperationKey).value(''))
      .then(() => etcd.put(updatelock).value('false'))
      .then(() => etcd.put(updatelockdetails).value(''))
      .then(() => etcd.put(backuplock).value('false'))
      .then(() => etcd.put(backuplockdetails).value(''))
      .then(() => etcd.put(restorelock).value('false'))
      .then(() => etcd.put(restorelockdetails).value(''))
  }

  updateResourceState(resourceType, resourceId, stateValue) {
    const resourceFolderName = `deployments/${resourceType}/${resourceId}`;
    const statusKey = `${resourceFolderName}/state`;
    logger.info('etcd3 ', statusKey)
    return etcd.put(statusKey).value(stateValue);
  }

  updateResourceKey(resourceType, resourceId, key, value) {
    const resourceFolderName = `deployments/${resourceType}/${resourceId}`;
    const statusKey = `${resourceFolderName}/${key}`;
    logger.info('etcd3 ', statusKey)
    return etcd.put(statusKey).value(value);
  }

  getResourceKey(resourceType, resourceId, key) {
    const resourceFolderName = `deployments/${resourceType}/${resourceId}`;
    const statusKey = `${resourceFolderName}/${key}`;
    logger.info('etcd3 ', statusKey)
    return etcd.get(statusKey).string();
  }

  getResourceState(resourceType, resourceId) {
    const resourceFolderName = `deployments/${resourceType}/${resourceId}`;
    const statusKey = `${resourceFolderName}/state`;
    return etcd.get(statusKey).string();
  }

  registerWatcher(key, callback, isRecursive) {
    return etcd.watch()
      .prefix(key) // use key if not recursive
      .create()
      .then(watcher => {
        watcher
          .on('put', callback)
      });
  }

  annotateResource(resourceType, resourceId, annotationName, operationType, opId, val) {
    const annotationFolderName = `deployments/${resourceType}/${resourceId}/${annotationName}/${operationType}/${opId}`;
    const optionKey = `${annotationFolderName}/options`;
    logger.info('etcd3 optionKey', optionKey)
    return etcd.put(optionKey).value(val)
      .then(() => {
        const statusKey = `${annotationFolderName}/state`;
        return etcd.put(statusKey).value(CONST.RESOURCE_STATE.IN_QUEUE);
      });
  }

  updateAnnotationState(resourceType, resourceId, annotationName, operationType, opId, stateValue) {
    const annotationFolderName = `deployments/${resourceType}/${resourceId}/${annotationName}/${operationType}/${opId}`;
    const statusKey = `${annotationFolderName}/state`;
    logger.info('etcd3 statusKey', statusKey, stateValue)
    return etcd.put(statusKey).value(stateValue);
  }

  updateAnnotationKey(resourceType, resourceId, annotationName, operationType, opId, key, value) {
    const annotationFolderName = `deployments/${resourceType}/${resourceId}/${annotationName}/${operationType}/${opId}`;
    const statusKey = `${annotationFolderName}/${key}`;
    logger.info('etcd3 statusKey', statusKey, value)
    return etcd.put(statusKey).value(value);
  }

  getAnnotationKey(resourceType, resourceId, annotationName, operationType, opId, key) {
    const annotationFolderName = `deployments/${resourceType}/${resourceId}/${annotationName}/${operationType}/${opId}`;
    const statusKey = `${annotationFolderName}/${key}`;
    return etcd.get(statusKey).string();
  }

  getAnnotationState(resourceType, resourceId, annotationName, operationType, opId) {
    const annotationFolderName = `deployments/${resourceType}/${resourceId}/${annotationName}/${operationType}/${opId}`;
    const statusKey = `${annotationFolderName}/state`;
    return etcd.get(statusKey).string();
  }

}

module.exports = Etcd3EventMeshServer;