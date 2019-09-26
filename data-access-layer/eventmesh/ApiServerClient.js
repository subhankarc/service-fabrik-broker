'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const assert = require('assert');
const yaml = require('js-yaml');
const config = require('../../common/config');
const logger = require('../../common/logger');
const CONST = require('../../common/constants');
const kc = require('kubernetes-client');
const JSONStream = require('json-stream');
const errors = require('../../common/errors');
const Timeout = errors.Timeout;
const BadRequest = errors.BadRequest;
const NotFound = errors.NotFound;
const PageNotFound = errors.PageNotFound;
const Conflict = errors.Conflict;
const camelcaseKeys = require('camelcase-keys');
const InternalServerError = errors.InternalServerError;

// TODO: For K8S get kubeconfig from with the container
const apiserverConfig = config.apiserver.getConfigInCluster ? kc.config.getInCluster() :
  (config.apiserver.pathToKubeConfig ?
    kc.config.fromKubeconfig(config.apiserver.pathToKubeConfig) : {
      url: `https://${config.apiserver.ip}:${config.apiserver.port}`,
      cert: config.apiserver.certificate,
      key: config.apiserver.private_key,
      insecureSkipTlsVerify: true
    });
const apiserver = new kc.Client({
  config: apiserverConfig,
  version: CONST.APISERVER.VERSION
});

function convertToHttpErrorAndThrow(err) {
  let message = err.message;
  if (err.error && err.error.description) {
    message = `${message}. ${err.error.description}`;
  }
  let newErr;
  let code;
  if (err.code) {
    code = err.code;
  } else if (err.status) {
    code = err.status;
  }
  switch (code) {
    case CONST.HTTP_STATUS_CODE.BAD_REQUEST:
      newErr = new BadRequest(message);
      break;
    case CONST.HTTP_STATUS_CODE.NOT_FOUND:
      if (message.includes('page not found')) {
        newErr = new PageNotFound(message);
      } else {
        newErr = new NotFound(message);
      }
      break;
    case CONST.HTTP_STATUS_CODE.CONFLICT:
      newErr = new Conflict(message);
      break;
    case CONST.HTTP_STATUS_CODE.FORBIDDEN:
      newErr = new errors.Forbidden(message);
      break;
    case CONST.HTTP_STATUS_CODE.GONE:
      newErr = new errors.Gone(message);
      break;
    default:
      newErr = new InternalServerError(message);
      break;
  }
  throw newErr;
}

class ApiServerClient {
  constructor() {	
    this.ready = false;
    this.init();
  }

  init() {
    return Promise.try(() => {
      return Promise.map(_.values(config.apiserver.crds), crdTemplate => {
        apiserver.addCustomResourceDefinition(yaml.safeLoad(Buffer.from(crdTemplate, 'base64')));
      })
        .tap(() => {
          logger.debug('Successfully added enpoints to apiserver client');
        })
        .catch(err => {
          logger.error('Error occured while adding enpoints to apiserver client', err);
          return convertToHttpErrorAndThrow(err);
        });
    });
  }

  /**
   * Poll for Status until opts.start_state changes
   * @param {object} opts - Object containing options
   * @param {string} opts.resourceGroup - Name of resource group ex. backup.servicefabrik.io
   * @param {string} opts.resourceType - Type of resource ex. defaultbackup
   * @param {string} opts.resourceId - Id of the operation ex. backupGuid
   * @param {string} opts.start_state - start state of the operation ex. in_queue
   * @param {object} opts.started_at - Date object specifying operation start time
   * @param {object} opts.timeout_in_sec - Req timeout in sec (optional)
   * @param {object} opts.namespaceId - namespace Id of resource
   */
  getResourceOperationStatus(opts) {
    logger.debug(`Waiting ${CONST.EVENTMESH_POLLER_DELAY} ms to get the operation state`);
    let finalState;
    return Promise.delay(CONST.EVENTMESH_POLLER_DELAY)
      .then(() => this.getResource({
        resourceGroup: opts.resourceGroup,
        resourceType: opts.resourceType,
        resourceId: opts.resourceId,
        namespaceId: opts.namespaceId
      }))
      .then(resource => {
        const state = _.get(resource, 'status.state');
        if (state === opts.start_state) {
          const duration = (new Date() - opts.started_at) / 1000;
          logger.debug(`Polling for ${opts.start_state} duration: ${duration} `);
          if (duration > _.get(opts, 'timeout_in_sec', CONST.APISERVER.OPERATION_TIMEOUT_IN_SECS)) {
            logger.error(`${opts.resourceGroup} with guid ${opts.resourceId} not yet processed after ${duration}s`);
            throw new Timeout(`${opts.resourceGroup} with guid ${opts.resourceId} not yet processed after ${duration}s`);
          }
          return this.getResourceOperationStatus(opts);
        } else if (
          state === CONST.APISERVER.RESOURCE_STATE.FAILED ||
          state === CONST.APISERVER.RESOURCE_STATE.DELETE_FAILED
        ) {
          finalState = state;
          if (_.get(resource, 'status.error')) {
            const errorResponse = _.get(resource, 'status.error');
            logger.info('Operation manager reported error', errorResponse);
            return convertToHttpErrorAndThrow(errorResponse);
          }
        } else {
          finalState = state;
          return _.get(resource, 'status.response');
        }
      })
      .then(result => {
        if (_.get(result, 'state')) {
          return result;
        }
        return {
          state: finalState,
          response: result
        };
      });
  }

  /**
   * Poll for Status until opts.start_state changes
   * @param {object} opts - Object containing options
   * @param {string} opts.resourceGroup - Name of resource group ex. osb.servicefabrik.io
   * @param {string} opts.resourceType - Type of resource ex. sfserviceinstance
   * @param {string} opts.resourceId - Id of the operation ex. instance_id
   * @param {string} opts.start_state - start state of the operation ex. in_queue
   * @param {object} opts.started_at - Date object specifying operation start time
   * @param {object} opts.timeout_in_sec - Req timeout in seconds (optional)
   * @param {object} opts.namespaceId - namespace Id of resource
   */
  // TODO:- merge getResourceOperationStatus and getOSBResourceOperationStatus after streamlining state conventions

  getOSBResourceOperationStatus(opts) {
    logger.debug(`Waiting ${CONST.EVENTMESH_POLLER_DELAY} ms to get the operation state`);
    let finalState;
    return Promise.delay(CONST.EVENTMESH_POLLER_DELAY)
      .then(() => this.getResource({
        resourceGroup: opts.resourceGroup,
        resourceType: opts.resourceType,
        resourceId: opts.resourceId,
        namespaceId: opts.namespaceId
      }))
      .then(resource => {
        const state = _.get(resource, 'status.state');
        if (state === CONST.APISERVER.RESOURCE_STATE.SUCCEEDED) {
          finalState = state;
          return _.get(resource, 'status.response');
        } else if (
          state === CONST.APISERVER.RESOURCE_STATE.FAILED
        ) {
          finalState = state;
          if (_.get(resource, 'status.error')) {
            const errorResponse = _.get(resource, 'status.error');
            logger.info('Operation manager reported error', errorResponse);
            return convertToHttpErrorAndThrow(errorResponse);
          }
        } else {
          const duration = (new Date() - opts.started_at) / 1000;
          logger.debug(`Polling for ${opts.start_state} duration: ${duration} `);
          if (duration > _.get(opts, 'timeout_in_sec', CONST.APISERVER.OPERATION_TIMEOUT_IN_SECS)) {
            logger.error(`${opts.resourceGroup} with guid ${opts.resourceId} not yet processed after ${duration}s`);
            throw new Timeout(`${opts.resourceGroup} with guid ${opts.resourceId} not yet processed after ${duration}s`);
          }
          return this.getOSBResourceOperationStatus(opts);
        }
      })
      .then(result => {
        if (_.get(result, 'state')) {
          return result;
        }
        return {
          state: finalState,
          response: result
        };
      });
  }

  /**
   * @description Register watcher for (resourceGroup , resourceType)
   * @param {string} resourceGroup - Name of the resource
   * @param {string} resourceType - Type of the resource
   * @param {string} callback - Fucntion to call when event is received
   */
  registerWatcher(resourceGroup, resourceType, callback, queryString) {
    assert.ok(resourceGroup, 'Argument \'resourceGroup\' is required to register watcher');
    assert.ok(resourceType, 'Argument \'resourceType\' is required to register watcher');
    return Promise.try(() => {
      const stream = apiserver
        .apis[resourceGroup][CONST.APISERVER.API_VERSION]
        .watch[resourceType].getStream({
          qs: {
            labelSelector: queryString ? queryString : '',
            timeoutSeconds: CONST.APISERVER.WATCH_TIMEOUT
          }
        });
      const jsonStream = new JSONStream();
      stream.pipe(jsonStream);
      jsonStream.on('data', callback);
      return stream;
    })
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      });
  }

  parseResourceDetailsFromSelfLink(selfLink) {
    // self links are typically: /apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/directors/d-7
    const linkParts = _.split(selfLink, '/');
    const resourceType = linkParts[6];
    const resourceGroup = linkParts[2];
    const resourceId = linkParts[7];
    return {
      resourceGroup: resourceGroup,
      resourceType: resourceType,
      resourceId: resourceId
    };
  }

  registerCrds(resourceGroup, resourceType) {
    logger.info(`Registering CRDs for ${resourceGroup}, ${resourceType}`);
    const crdJson = this.getCrdJson(resourceGroup, resourceType);
    if (!crdJson){
      return Promise.resolve()
    }
    return Promise.try(() => apiserver.apis[CONST.APISERVER.CRD_RESOURCE_GROUP].v1beta1.customresourcedefinitions(crdJson.metadata.name).patch({
      body: crdJson,
      headers: {
        'content-type': CONST.APISERVER.PATCH_CONTENT_TYPE
      }
    }))
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      })
      .catch(NotFound, () => {
        logger.info(`CRD with resourcegroup ${resourceGroup} and resource ${resourceType} not yet registered, registering it now..`);
        return apiserver.apis[CONST.APISERVER.CRD_RESOURCE_GROUP].v1beta1.customresourcedefinitions.post({
          body: crdJson
        });
      })
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      });
  }

  getCrdJson(resourceGroup, resourceType) {
    const crdEncodedTemplate = config.apiserver.crds[`${resourceGroup}_${CONST.APISERVER.API_VERSION}_${resourceType}.yaml`];
    if (crdEncodedTemplate){
      logger.debug(`Getting crd json for: ${resourceGroup}_${CONST.APISERVER.API_VERSION}_${resourceType}.yaml`);
      return yaml.safeLoad(Buffer.from(crdEncodedTemplate, 'base64'));
    }
  }

  /**
   * @description Create Namespace of given name
   * @param {string} name - Name of resource group ex. backup.servicefabrik.io
   */
  createNamespace(name) {
    assert.ok(name, 'Property \'name\' is required to create namespace');
    if (name === CONST.APISERVER.DEFAULT_NAMESPACE) {
      return Promise.resolve();
    }
    const resourceBody = {
      kind: CONST.APISERVER.NAMESPACE_OBJECT,
      apiVersion: CONST.APISERVER.NAMESPACE_API_VERSION,
      metadata: {
        name: name
      }
    };
    return Promise.try(() => apiserver.api[CONST.APISERVER.NAMESPACE_API_VERSION].ns.post({
      body: resourceBody
    }))
      .tap(() => logger.debug(`Successfully created namespace ${name}`))
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      });
  }

  deleteNamespace(name) {
    return Promise.try(() => apiserver.api[CONST.APISERVER.NAMESPACE_API_VERSION].ns(name).delete())
      .tap(() => logger.debug(`Successfully deleted namespace ${name}`))
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      });
  }

  getNamespaceId(resourceId) {
    return _.get(config, 'apiserver.enable_namespace') ? `sf-${resourceId}` : CONST.APISERVER.DEFAULT_NAMESPACE;
  }

  /**
   * @description Gets secret
   * @param {string} secretId - Secret Id
   * @param {string} namespaceId - Optional; Namespace id if given
   */
  getSecret(secretId, namespaceId) {
    assert.ok(secretId, 'Property \'secretId\' is required to get Secret');
    return Promise.try(() => apiserver
      .api[CONST.APISERVER.SECRET_API_VERSION]
      .namespaces(namespaceId ? namespaceId : CONST.APISERVER.DEFAULT_NAMESPACE)
      .secrets(secretId).get())
      .then(secret => secret.body)
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      });
  }

  /**
   * @description Create Resource in Apiserver with the opts
   * @param {string} opts.resourceGroup - Name of resource group ex. backup.servicefabrik.io
   * @param {string} opts.resourceType - Type of resource ex. defaultbackup
   * @param {string} opts.resourceId - Unique id of resource ex. backup_guid
   * @param {string} opts.labels - to be put in label ex: instance_guid
   * @param {Object} opts.options - Value to set for spec.options field of resource
   * @param {string} opts.status - status of the resource
   */
  createResource(opts) {
    logger.info('Creating resource with opts: ', opts);
    assert.ok(opts.resourceGroup, 'Property \'resourceGroup\' is required to create resource');
    assert.ok(opts.resourceType, 'Property \'resourceType\' is required to create resource');
    assert.ok(opts.resourceId, 'Property \'resourceId\' is required to create resource');
    assert.ok(opts.options, 'Property \'options\' is required to create resource');
    const metadata = {
      name: opts.resourceId
    };
    if (opts.labels) {
      // TODO-PR: revisit key name instance_guid
      metadata.labels = opts.labels;
    }
    const crdJson = this.getCrdJson(opts.resourceGroup, opts.resourceType);
    const resourceBody = {
      apiVersion: `${crdJson.spec.group}/${crdJson.spec.version}`,
      kind: crdJson.spec.names.kind,
      metadata: metadata,
      spec: {
        'options': JSON.stringify(opts.options)
      }
    };

    if (opts.status) {
      const statusJson = {};
      _.forEach(opts.status, (val, key) => {
        if (key === 'state') {
          resourceBody.metadata.labels = _.merge(resourceBody.metadata.labels, {
            'state': val
          });
        }
        statusJson[key] = _.isObject(val) ? JSON.stringify(val) : val;
      });
      resourceBody.status = statusJson;
    }
    const namespaceId = this.getNamespaceId(opts.resourceId);
    // Create Namespace if not default
    return Promise.try(() => apiserver
      .apis[opts.resourceGroup][CONST.APISERVER.API_VERSION]
      .namespaces(namespaceId)[opts.resourceType].post({
        body: resourceBody
      }))
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      });
  }

  /**
   * @description Update Resource in Apiserver with the opts
   * @param {string} opts.resourceGroup - Name of resource group ex. backup.servicefabrik.io
   * @param {string} opts.resourceType - Type of resource ex. defaultbackup
   * @param {string} opts.resourceId - Unique id of resource ex. backup_guid
   * @param {string} opts.metadata - Metadata of resource
   * @param {Object} opts.options - Value to set for spec.options field of resource
   * @param {string} opts.status - status of the resource
   */
  updateResource(opts) {
    logger.silly('Updating resource with opts: ', opts);
    assert.ok(opts.resourceGroup, 'Property \'resourceGroup\' is required to update resource');
    assert.ok(opts.resourceType, 'Property \'resourceType\' is required to update resource');
    assert.ok(opts.resourceId, 'Property \'resourceId\' is required to update resource');
    assert.ok(opts.metadata || opts.options || opts.status || opts.operatorMetadata, 'Property \'metadata\' or \'options\' or \'status\' or \'operatorMetadata\'  is required to update resource');
    return Promise.try(() => {
      const patchBody = {};
      if (opts.metadata) {
        patchBody.metadata = opts.metadata;
      }
      if (opts.options) {
        patchBody.spec = {
          'options': JSON.stringify(opts.options)
        };
      }
      if (opts.operatorMetadata) {
        patchBody.operatorMetadata = opts.operatorMetadata;
      }
      if (opts.status) {
        const statusJson = {};
        _.forEach(opts.status, (val, key) => {
          if (key === 'state') {
            patchBody.metadata = _.merge(patchBody.metadata, {
              labels: {
                'state': val
              }
            });
          }
          statusJson[key] = _.isObject(val) ? JSON.stringify(val) : val;
        });
        patchBody.status = statusJson;
      }
      logger.info(`Updating - Resource ${opts.resourceId} with body - ${JSON.stringify(patchBody)}`);
      const namespaceId = this.getNamespaceId(opts.resourceId);
      // Create Namespace if not default
      return Promise.try(() => apiserver
        .apis[opts.resourceGroup][CONST.APISERVER.API_VERSION]
        .namespaces(namespaceId)[opts.resourceType](opts.resourceId).patch({
          body: patchBody,
          headers: {
            'content-type': CONST.APISERVER.PATCH_CONTENT_TYPE
          }
        }));
    })
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      });
  }
  /**
   * @description Patches Resource in Apiserver with the opts
   * Use this method when you want to append something in status.response or spec.options
   * @param {string} opts.resourceGroup - Name of resource group ex. backup.servicefabrik.io
   * @param {string} opts.resourceType - Type of resource ex. defaultbackup
   * @param {string} opts.resourceId - Unique id of resource ex. backup_guid
   */
  patchResource(opts) {
    logger.info('Patching resource options with opts: ', opts);
    assert.ok(opts.resourceGroup, 'Property \'resourceGroup\' is required to patch options');
    assert.ok(opts.resourceType, 'Property \'resourceType\' is required to patch options');
    assert.ok(opts.resourceId, 'Property \'resourceId\' is required to patch options');
    assert.ok(opts.metadata || opts.options || opts.status || opts.operatorMetadata, 'Property \'metadata\' or \'options\' or \'status\' or \'operatorMetadata\' is required to patch resource');
    return this.getResource(opts)
      .then(resource => {
        if (_.get(opts, 'status.response') && resource.status) {
          const oldResponse = _.get(resource, 'status.response');
          const response = _.merge(oldResponse, opts.status.response);
          _.set(opts.status, 'response', response);
        }
        if (opts.options && resource.spec) {
          const oldOptions = _.get(resource, 'spec.options');
          const options = _.merge(oldOptions, opts.options);
          _.set(opts, 'options', options);
        }
        if (opts.operatorMetadata && resource.operatorMetadata) {
          const oldOperatorMetadata = _.get(resource, 'operatorMetadata');
          const operatorMetadata = _.merge(oldOperatorMetadata, opts.operatorMetadata);
          _.set(opts, 'operatorMetadata', operatorMetadata);
        }
        return this.updateResource(opts);
      });
  }

  /**
   * @description Delete Resource in Apiserver with the opts
   * @param {string} opts.resourceGroup - Name of resource group ex. backup.servicefabrik.io
   * @param {string} opts.resourceType - Type of resource ex. defaultbackup
   * @param {string} opts.resourceId - Unique id of resource ex. backup_guid
   */
  deleteResource(opts) {
    logger.info('Deleting resource with opts: ', opts);
    assert.ok(opts.resourceGroup, 'Property \'resourceGroup\' is required to delete resource');
    assert.ok(opts.resourceType, 'Property \'resourceType\' is required to delete resource');
    assert.ok(opts.resourceId, 'Property \'resourceId\' is required to delete resource');
    const namespaceId = opts.namespaceId ? opts.namespaceId : this.getNamespaceId(opts.resourceId);
    return Promise.try(() => apiserver.apis[opts.resourceGroup][CONST.APISERVER.API_VERSION]
      .namespaces(namespaceId)[opts.resourceType](opts.resourceId).delete())
      .then(res => {
        if (namespaceId !== CONST.APISERVER.DEFAULT_NAMESPACE && opts.resourceType === CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES) {
          return this.deleteNamespace(namespaceId);
        }
        return res;
      })
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      });
  }

  /**
   * @description Update Last Operation to opts.value for resource
   * @param {string} opts.resourceGroup - Name of resource group ex. backup.servicefabrik.io
   * @param {string} opts.resourceType - Type of resource ex. defaultbackup
   * @param {string} opts.resourceId - Unique id of resource ex. backup_guid
   * @param {string} opts.operationName - Name of operation which was last operation
   * @param {string} opts.operationType - Type of operation which was last operation
   * @param {Object} opts.value - Unique id of the last operation ex: backup_guid
   */
  updateLastOperationValue(opts) {
    logger.info('Updating last operation with opts: ', opts);
    assert.ok(opts.resourceGroup, 'Property \'resourceGroup\' is required to update lastOperation');
    assert.ok(opts.resourceType, 'Property \'resourceType\' is required to update lastOperation');
    assert.ok(opts.resourceId, 'Property \'resourceId\' is required to update lastOperation');
    assert.ok(opts.operationName, 'Property \'operationName\' is required to update lastOperation');
    assert.ok(opts.operationType, 'Property \'operationType\' is required to update lastOperation');
    assert.ok(opts.value, 'Property \'value\' is required to update lastOperation');
    const metadata = {};
    metadata.labels = {};
    metadata.labels[`last_${opts.operationName}_${opts.operationType}`] = opts.value;
    const options = _.chain(opts)
      .omit('value', 'operationName', 'operationType')
      .set('metadata', metadata)
      .value();
    return this.updateResource(options);
  }

  /**
   * @description Get Resource in Apiserver with the opts
   * @param {string} opts.resourceGroup - Unique id of resource
   * @param {string} opts.resourceType - Name of operation
   * @param {string} opts.resourceId - Type of operation
   * @param {string} opts.namespaceId - optional; namespace of resource
   */
  getResource(opts) {
    logger.debug('Get resource with opts: ', opts);
    assert.ok(opts.resourceGroup, 'Property \'resourceGroup\' is required to get resource');
    assert.ok(opts.resourceType, 'Property \'resourceType\' is required to get resource');
    assert.ok(opts.resourceId, 'Property \'resourceId\' is required to get resource');
    const namespaceId = opts.namespaceId ? opts.namespaceId : CONST.APISERVER.DEFAULT_NAMESPACE;
    return Promise.try(() => apiserver.apis[opts.resourceGroup][CONST.APISERVER.API_VERSION]
      .namespaces(namespaceId)[opts.resourceType](opts.resourceId).get())
      .then(resource => {
        _.forEach(resource.body.spec, (val, key) => {
          try {
            resource.body.spec[key] = JSON.parse(val);
          } catch (err) {
            resource.body.spec[key] = val;
          }
        });
        _.forEach(resource.body.status, (val, key) => {
          try {
            resource.body.status[key] = JSON.parse(val);
          } catch (err) {
            resource.body.status[key] = val;
          }
        });
        return resource.body;
      })
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      });
  }

  /**
   * @description Get Resources in Apiserver with the opts and query param
   * @param {string} opts.resourceGroup - Unique id of resource
   * @param {string} opts.resourceType - Name of operation
   * @param {string} opts.namespaceId - namesapce Id: optional
   * @param {object} opts.query - optional query
   * @param {boolean} opts.allNamespaces - optional, get  resources across all namespaces
   */
  getResources(opts) {
    logger.debug('Get resources with opts: ', opts);
    assert.ok(opts.resourceGroup, 'Property \'resourceGroup\' is required to get resource');
    assert.ok(opts.resourceType, 'Property \'resourceType\' is required to get resource');
    let query = {};
    if (opts.query) {
      query.qs = opts.query;
    }
    const namespaceId = opts.namespaceId ? opts.namespaceId : CONST.APISERVER.DEFAULT_NAMESPACE;
    return Promise.try(() => {
      if (!_.get(opts, 'allNamespaces', false)) {
        return apiserver.apis[opts.resourceGroup][CONST.APISERVER.API_VERSION]
          .namespaces(namespaceId)[opts.resourceType].get(query);
      } else {
        return apiserver.apis[opts.resourceGroup][CONST.APISERVER.API_VERSION].namespaces()[opts.resourceType].get(query);
      }
    })
      .then(response => _.get(response, 'body.items', []))
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      });
  }

  /**
   * @description Get Resource in Apiserver with the opts
   * @param {string} opts.resourceGroup - Unique id of resource
   * @param {string} opts.resourceType - Name of operation
   * @param {object} opts.query - optional query
   */
  _getParsedResources(opts) {
    return this.getResources(opts)
      .then(resources => {
        _.forEach(resources, resource => {
          _.forEach(resource.spec, (val, key) => {
            try {
              resource.spec[key] = JSON.parse(val);
            } catch (err) {
              resource.spec[key] = val;
            }
          });
          _.forEach(resource.status, (val, key) => {
            try {
              resource.status[key] = JSON.parse(val);
            } catch (err) {
              resource.status[key] = val;
            }
          });
        });
        if (resources.length > 0) {
          return _.sortBy(resources, ['metadata.creationTimeStamp']);
        }
        return [];
      });
  }

  createConfigMapResource(configName, configParam) {
    logger.info(`Creating ConfigMap ${configName} with data: ${configParam}`);
    const metadata = {
      name: configName
    };
    let data = {};
    data = _.set(data, configParam.key, configParam.value);
    const resourceBody = {
      apiVersion: CONST.APISERVER.CONFIG_MAP.API_VERSION,
      kind: CONST.APISERVER.CONFIG_MAP.RESOURCE_KIND,
      metadata: metadata,
      data: data
    };
    return Promise.try(() => apiserver.api[CONST.APISERVER.CONFIG_MAP.API_VERSION]
      .namespaces(CONST.APISERVER.DEFAULT_NAMESPACE)[CONST.APISERVER.CONFIG_MAP.RESOURCE_TYPE].post({
        body: resourceBody
      }))
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      });
  }

  getConfigMapResource(configName) {
    logger.debug('Get resource with opts: ', configName);
    return Promise.try(() => apiserver.api[CONST.APISERVER.CONFIG_MAP.API_VERSION]
      .namespaces(CONST.APISERVER.DEFAULT_NAMESPACE)[CONST.APISERVER.CONFIG_MAP.RESOURCE_TYPE](configName).get())
      .then(resource => {
        return resource.body;
      })
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      });
  }

  createUpdateConfigMapResource(configName, configParam) {
    const metadata = {
      name: configName
    };
    let data = {};
    data = _.set(data, configParam.key, configParam.value);
    const resourceBody = {
      apiVersion: CONST.APISERVER.CONFIG_MAP.API_VERSION,
      kind: CONST.APISERVER.CONFIG_MAP.RESOURCE_KIND,
      metadata: metadata,
      data: data
    };
    return Promise.try(() => this.getConfigMapResource(configName))
      .then(oldResourceBody => {
        resourceBody.data = oldResourceBody.data ? _.merge(oldResourceBody.data, data) : resourceBody.data;
        resourceBody.metadata.resourceVersion = oldResourceBody.metadata.resourceVersion;
        return apiserver.api[CONST.APISERVER.CONFIG_MAP.API_VERSION]
          .namespaces(CONST.APISERVER.DEFAULT_NAMESPACE)[CONST.APISERVER.CONFIG_MAP.RESOURCE_TYPE](configName).patch({
            body: resourceBody
          });
      })
      .catch(errors.NotFound, () => {
        return this.createConfigMapResource(configName, configParam);
      });
  }

  getConfigMap(configName, key) {
    return this.getConfigMapResource(configName).then(body => _.get(body.data, key))
      .catch(errors.NotFound, () => {
        return undefined;
      });
  }

  /**
   * @description Get Resource in Apiserver with the opts
   * @param {string} opts.resourceGroup - Unique id of resource
   * @param {string} opts.resourceType - Name of operation
   * @param {array} opts.stateList - Array of states of resorces
   */
  getResourceListByState(opts) {
    logger.debug('Get resource list with opts: ', opts);
    assert.ok(opts.resourceGroup, 'Property \'resourceGroup\' is required to get resource list');
    assert.ok(opts.resourceType, 'Property \'resourceType\' is required to get resource list');
    assert.ok(opts.stateList, 'Property \'stateList\' is required to fetch resource list');
    return this._getParsedResources(_.assign(opts, {
      query: {
        labelSelector: `state in (${_.join(opts.stateList, ',')})`
      }
    }));
  }

  /**
   * @description Gets Last Operation
   * @param {string} opts.resourceId - Unique id of resource
   * @param {string} opts.resourceGroup - Name of operation
   * @param {string} opts.resourceType - Type of operation
   * @param {string} opts.operationName - Name of operation
   * @param {string} opts.operationType - Type of operation
   */
  getLastOperationValue(opts) {
    assert.ok(opts.resourceGroup, 'Property \'resourceGroup\' is required to get lastOperation');
    assert.ok(opts.resourceType, 'Property \'resourceType\' is required to get lastOperation');
    assert.ok(opts.resourceId, 'Property \'resourceId\' is required to get lastOperation');
    assert.ok(opts.operationName, 'Property \'operationName\' is required to get lastOperation');
    assert.ok(opts.operationType, 'Property \'operationType\' is required to get lastOperation');
    let options = _.chain(opts)
      .omit('operationName', 'operationType')
      .value();
    logger.debug(`Getting label:  last_${opts.operationName}_${opts.operationType}`);
    return this.getResource(options)
      .then(json => _.get(json.metadata, `labels.last_${opts.operationName}_${opts.operationType}`));
  }

  /**
   * @description Get resource Options
   * @param {string} opts.resourceGroup - Name of operation
   * @param {string} opts.resourceType - Type of operation
   * @param {string} opts.resourceId - Unique id of resource
   */
  getOptions(opts) {
    return this.getResource(opts)
      .then(resource => _.get(resource, 'spec.options'));
  }

  /**
   * @description Get resource response
   * @param {string} opts.resourceGroup - Name of operation
   * @param {string} opts.resourceType - Type of operation
   * @param {string} opts.resourceId - Unique id of resource
   */
  getResponse(opts) {
    return this.getResource(opts)
      .then(resource => _.get(resource, 'status.response'));
  }

  /**
   * @description Get resource state
   * @param {string} opts.resourceGroup - Name of operation
   * @param {string} opts.resourceType - Type of operation
   * @param {string} opts.resourceId - Unique id of resource
   */
  getResourceState(opts) {
    return this.getResource(opts)
      .then(resource => _.get(resource, 'status.state'));
  }


  /**
   * @description Get resource status
   * @param {string} opts.resourceGroup - Name of operation
   * @param {string} opts.resourceType - Type of operation
   * @param {string} opts.resourceId - Unique id of resource
   */
  getResourceStatus(opts) {
    return this.getResource(opts)
      .then(resource => _.get(resource, 'status'));
  }

  /**
   * @description Get resource last operation
   * @param {string} opts.resourceGroup - Name of operation
   * @param {string} opts.resourceType - Type of operation
   * @param {string} opts.resourceId - Unique id of resource
   */
  getLastOperation(opts) {
    return this.getResource(opts)
      .then(resource => _.get(resource, 'status'));
  }

  /**
   * @description Get platform context
   * @param {string} opts.resourceGroup - Name of resourceGroup
   * @param {string} opts.resourceType - Type of resource
   * @param {string} opts.resourceId - Unique id of resource
   */
  getPlatformContext(opts) {
    return this.getResource({
      resourceGroup: opts.resourceGroup,
      resourceType: opts.resourceType,
      resourceId: opts.resourceId
    })
      .then(resource => _.get(resource, 'spec.options.context'));
  }

  /**
   * @description Create OSB Resource in Apiserver with the opts
   * @param {string} opts.resourceGroup - Name of resource group 
   * @param {string} opts.resourceType - Type of resource 
   * @param {string} opts.resourceId - Unique id of resource 
   * @param {string} opts.metadata - Optional; pass finalizers or some other field
   * @param {string} opts.labels - to be put in label
   * @param {Object} opts.spec - Value to set for spec field of resource
   * @param {string} opts.status - status of the resource
   */
  // Note:- In this method, keys in ServiceInstance CR are required to be camelcased
  // Hence while creating resource, osb keys (snakecased) translated into camelcased using camelcase-keys module
  createOSBResource(opts) {
    logger.info('Creating OSB resource with opts: ', opts);
    assert.ok(opts.resourceGroup, 'Property \'resourceGroup\' is required to create resource');
    assert.ok(opts.resourceType, 'Property \'resourceType\' is required to create resource');
    assert.ok(opts.resourceId, 'Property \'resourceId\' is required to create resource');
    assert.ok(opts.spec, 'Property \'spec\' is required to create resource');
    const metadata = _.merge(opts.metadata, {
      name: opts.resourceId
    });
    if (opts.labels) {
      metadata.labels = opts.labels;
    }
    const crdJson = this.getCrdJson(opts.resourceGroup, opts.resourceType);
    const resourceBody = {
      apiVersion: `${crdJson.spec.group}/${crdJson.spec.version}`,
      kind: crdJson.spec.names.kind,
      metadata: metadata,
      spec: camelcaseKeys(opts.spec)
    };

    if (opts.status) {
      _.forEach(opts.status, (val, key) => {
        if (key === 'state') {
          resourceBody.metadata.labels = _.merge(resourceBody.metadata.labels, {
            'state': val
          });
        }
      });
      resourceBody.status = opts.status;
    }
    // Create Namespace if not default
    const namespaceId = this.getNamespaceId(opts.resourceType === CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS ?
      _.get(opts, 'spec.instance_id') : opts.resourceId
    );
    // Create Namespace if not default
    return Promise.try(() => apiserver
      .apis[opts.resourceGroup][CONST.APISERVER.API_VERSION]
      .namespaces(namespaceId)[opts.resourceType].post({
        body: resourceBody
      }))
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      });
  }

  /**
   * @description Update OSB Resource in Apiserver with the opts
   * @param {string} opts.resourceGroup - Name of resource group ex. backup.servicefabrik.io
   * @param {string} opts.resourceType - Type of resource ex. defaultbackup
   * @param {string} opts.resourceId - Unique id of resource ex. backup_guid
   * @param {string} opts.metadata - Metadata of resource
   * @param {Object} opts.spec - Value to set for spec field of resource
   * @param {string} opts.status - status of the resource
   */
  updateOSBResource(opts) {
    logger.silly('Updating resource with opts: ', opts);
    assert.ok(opts.resourceGroup, 'Property \'resourceGroup\' is required to update resource');
    assert.ok(opts.resourceType, 'Property \'resourceType\' is required to update resource');
    assert.ok(opts.resourceId, 'Property \'resourceId\' is required to update resource');
    assert.ok(opts.metadata || opts.spec || opts.status, 'Property \'metadata\' or \'options\' or \'status\'  is required to update resource');
    return Promise.try(() => {
      const patchBody = {};
      if (opts.metadata) {
        patchBody.metadata = opts.metadata;
      }
      if (opts.spec) {
        patchBody.spec = camelcaseKeys(opts.spec);
      }
      if (opts.status) {
        _.forEach(opts.status, (val, key) => {
          if (key === 'state') {
            patchBody.metadata = _.merge(patchBody.metadata, {
              labels: {
                'state': val
              }
            });
          }
        });
        patchBody.status = opts.status;
      }
      logger.info(`Updating - Resource ${opts.resourceId} with body - ${JSON.stringify(patchBody)}`);
      // Create Namespace if not default
      const namespaceId = opts.namespaceId ? opts.namespaceId : this.getNamespaceId(opts.resourceType === CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS ?
        _.get(opts, 'spec.instance_id') : opts.resourceId
      );
      return Promise.try(() => apiserver
        .apis[opts.resourceGroup][CONST.APISERVER.API_VERSION]
        .namespaces(namespaceId)[opts.resourceType](opts.resourceId).patch({
          body: patchBody,
          headers: {
            'content-type': CONST.APISERVER.PATCH_CONTENT_TYPE
          }
        }));
    })
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      });
  }

  /**
   * @description Patches OSB Resource in Apiserver with the opts
   * Use this method when you want to append something in status.response or spec
   * @param {string} opts.resourceGroup - Name of resource group ex. backup.servicefabrik.io
   * @param {string} opts.resourceType - Type of resource ex. defaultbackup
   * @param {string} opts.resourceId - Unique id of resource ex. backup_guid
   * @param {string} opts.namespaceId - Unique id of namespace
   */
  patchOSBResource(opts) {
    logger.info('Patching resource options with opts: ', opts);
    assert.ok(opts.resourceGroup, 'Property \'resourceGroup\' is required to patch options');
    assert.ok(opts.resourceType, 'Property \'resourceType\' is required to patch options');
    assert.ok(opts.resourceId, 'Property \'resourceId\' is required to patch options');
    assert.ok(opts.metadata || opts.spec || opts.status, 'Property \'metadata\' or \'options\' or \'status\' is required to patch resource');

    return Promise.try(() => {
      if(_.get(opts, 'status.state') === CONST.APISERVER.RESOURCE_STATE.UPDATE) {
        // set parameters field to null
        const clearParamsReqOpts = _.pick(opts, ['resourceGroup', 'resourceType', 'resourceId']);
        return this.updateOSBResource(_.extend(clearParamsReqOpts, { 'spec': { 'parameters': null } }));
      }
    })
      .then(() => this.updateOSBResource(opts));
  }

  /**
   * @description Remove finalizers from finalizer list
   * @param {string} opts.resourceGroup - Name of resource group 
   * @param {string} opts.resourceType - Type of resource 
   * @param {string} opts.resourceId - Unique id of resource
   * @param {string} opts.finalizer - Name of finalizer
   */
  removeFinalizers(opts) {
    assert.ok(opts.resourceGroup, 'Property \'resourceGroup\' is required to remove finalizer');
    assert.ok(opts.resourceType, 'Property \'resourceType\' is required to remove finalizer');
    assert.ok(opts.resourceId, 'Property \'resourceId\' is required to remove finalizer');
    assert.ok(opts.finalizer, 'Property \'finalizer\' is required to remove finalizer');
    opts.namespaceId = opts.namespaceId ? opts.namespaceId : CONST.APISERVER.DEFAULT_NAMESPACE;
    return this.getResource(opts)
      .then(resourceBody => {
        opts.metadata = {
          resourceVersion: _.get(resourceBody, 'metadata.resourceVersion'),
          finalizers: _.pull(_.get(resourceBody, 'metadata.finalizers'), opts.finalizer)
        };
        return this.updateOSBResource(opts);
      });

  }

  /**
   * @description Create Service/Plan Resource in Apiserver with given crd
   */
  createOrUpdateServicePlan(crd) {
    logger.debug('Creating service/plan resource with CRD: ', crd);
    assert.ok(crd, 'Property \'crd\' is required to create Service/Plan Resource');
    const resourceType = crd.kind === 'SFService' ? CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICES : CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_PLANS;
    return Promise.try(() => apiserver
      .apis[CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR][CONST.APISERVER.API_VERSION]
      .namespaces(CONST.APISERVER.DEFAULT_NAMESPACE)[resourceType].post({
        body: crd
      }))
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      })
      .catch(Conflict, () => apiserver
        .apis[CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.DEFAULT_NAMESPACE)[resourceType](crd.metadata.name).patch({
          body: crd,
          headers: {
            'content-type': CONST.APISERVER.PATCH_CONTENT_TYPE
          }
        }))
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      });
  }
}

module.exports = ApiServerClient;
