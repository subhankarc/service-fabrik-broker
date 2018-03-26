'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const config = require('../config');
const CONST = require('../../lib/constants');

Promise.promisifyAll([require('node-etcd')]);
const Etcd = require('node-etcd');
const etcd = new Etcd(config.etcd.url);

class EtcdEventMeshServer {

  //##########################################
  //#####Service Registration API#############
  //##########################################
  registerServices(resourceType, serviceId, serviceAttributesValue, servicePlansValue) {
    const serviceFolderName = `services/${resourceType}/${serviceId}`;
    const optionKey = `${serviceFolderName}/attributes`;
    return etcd.setAsync(optionKey, JSON.stringify(serviceAttributesValue))
      .then(() => {
        const plansKey = `${serviceFolderName}/plans`;
        return etcd.setAsync(plansKey, JSON.stringify(servicePlansValue));
      });
  }

  getServiceAttributes(resourceType, serviceId) {
    const resourceFolderName = `services/${resourceType}/${serviceId}`;
    const attrKey = `${resourceFolderName}/attributes`;
    return etcd.getAsync(attrKey).then(statusNode => {
      return JSON.parse(statusNode.node.value);
    });
  }

  getServicePlans(resourceType, serviceId) {
    const resourceFolderName = `services/${resourceType}/${serviceId}`;
    const attrKey = `${resourceFolderName}/plans`;
    return etcd.getAsync(attrKey).then(statusNode => {
      return JSON.parse(statusNode.node.value);
    });
  }

  getAllServices() {
    var map = {};
    var serviceNames = [];
    return etcd.getAsync('services')
      .then(value => value.node.nodes)
      .map(resourceNode => etcd.getAsync(resourceNode.key))
      .map(value => value.node.nodes)
      .map(service => {
        return Promise.all([
            etcd.getAsync(`${service[0].key}/attributes`),
            etcd.getAsync(`${service[0].key}/plans`)
          ])
          .spread((attrs, plans) => {
            const serviceName = _.split(attrs.node.key, '/')[3];
            if (map[serviceName] === undefined) {
              serviceNames.push(serviceName);
              map[serviceName] = JSON.parse(attrs.node.value);
              map[serviceName].plans = [];
            }
            console.log('Provisioner is ', _.split(attrs.node.key, '/')[2]);
            console.log(JSON.parse(plans.node.value)[0].name);
            map[serviceName].plans.push(JSON.parse(plans.node.value));
          });

      })
      .then(() => {
        var allServices = [];
        for (let index = 0; index < serviceNames.length; ++index) {
          allServices.push(map[serviceNames[index]]);
        }
        return allServices;
      });
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
      }).then(() => {
        const lastOperationKey = `${resourceFolderName}/lastoperation`;
        return etcd.setAsync(lastOperationKey, '');
      }).then(() => {
        const updatelock = `${resourceFolderName}/updatelock`;
        return etcd.setAsync(updatelock, 'false');
      }).then(() => {
        const updatelockdetails = `${resourceFolderName}/updatelockdetails`;
        return etcd.setAsync(updatelockdetails, '');
      }).then(() => {
        const backuplock = `${resourceFolderName}/backuplock`;
        return etcd.setAsync(backuplock, 'false');
      }).then(() => {
        const backuplockdetails = `${resourceFolderName}/backuplockdetails`;
        return etcd.setAsync(backuplockdetails, '');
      }).then(() => {
        const restorelock = `${resourceFolderName}/restorelock`;
        return etcd.setAsync(restorelock, 'false');
      }).then(() => {
        const restorelockdetails = `${resourceFolderName}/restorelockdetails`;
        return etcd.setAsync(restorelockdetails, '');
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
    watcher.on('change', callback);
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

module.exports = EtcdEventMeshServer;