'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const config = require('../config');
const logger = require('../logger');
const errors = require('../errors');
const bosh = require('../bosh');
const cf = require('../cf');
const backupStore = require('../iaas').backupStore;
const utils = require('../utils');
const eventmesh = require('../eventmesh');
const Agent = require('./Agent');
const BaseManager = require('./BaseManager');
const DirectorInstance = require('./DirectorInstance');
const CONST = require('../constants');
const BoshDirectorClient = bosh.BoshDirectorClient;
const NetworkSegmentIndex = bosh.NetworkSegmentIndex;
const EvaluationContext = bosh.EvaluationContext;
const Networks = bosh.manifest.Networks;
const Header = bosh.manifest.Header;
const NotFound = errors.NotFound;
const BadRequest = errors.BadRequest;
const NotImplemented = errors.NotImplemented;
const ServiceInstanceAlreadyExists = errors.ServiceInstanceAlreadyExists;
const ServiceInstanceNotOperational = errors.ServiceInstanceNotOperational;
const ServiceBindingNotFound = errors.ServiceBindingNotFound;
const ServiceInstanceNotFound = errors.ServiceInstanceNotFound;
const Forbidden = errors.Forbidden;
const catalog = require('../models/catalog');

class DirectorManager extends BaseManager {
  constructor(plan) {
    super(plan);
    this.director = bosh.director;
    this.backupStore = backupStore;
    this.agent = new Agent(this.settings.agent);
  }

  isAutoUpdatePossible() {
    return true;
  }

  get networkName() {
    return this.subnet || BoshDirectorClient.getInfrastructure().segmentation.network_name || 'default';
  }

  get resourcePools() {
    const networkName = this.networkName;
    const stemcell = this.stemcell;
    return _.reduce(BoshDirectorClient.getInfrastructure().azs, (result, az) => {
      _.forEach(BoshDirectorClient.getInfrastructure().vm_types, vm_type => {
        result.push({
          name: `${vm_type.name}_${az.name}`,
          network: `${networkName}_${az.name}`,
          stemcell: stemcell,
          cloud_properties: _.assign({}, az.cloud_properties, vm_type.cloud_properties)
        });
      });
      return result;
    }, []);
  }

  getDeploymentName(guid, networkSegmentIndex) {
    let subnet = this.subnet ? `_${this.subnet}` : '';
    logger.info("Deployment name", `${DirectorManager.prefix}${subnet}-${NetworkSegmentIndex.adjust(networkSegmentIndex)}-${guid}`);
    return `${DirectorManager.prefix}${subnet}-${NetworkSegmentIndex.adjust(networkSegmentIndex)}-${guid}`;
  }

  getNetworkSegmentIndex(deploymentName) {
    return _.nth(DirectorManager.parseDeploymentName(deploymentName, this.subnet), 1);
  }

  getInstanceGuid(deploymentName) {
    return _.nth(DirectorManager.parseDeploymentName(deploymentName, this.subnet), 2);
  }

  getNetworks(index) {
    return new Networks(BoshDirectorClient.getInfrastructure().networks, index, BoshDirectorClient.getInfrastructure().segmentation);
  }

  getNetwork(index) {
    return this.getNetworks(index)[this.networkName];
  }


  findNetworkSegmentIndex(guid) {
    logger.info(`Finding network segment index of an existing deployment with instance id '${guid}'...`);
    return this
      .director
      .getDeploymentNameForInstanceId(guid)
      .then(deploymentName => this.getNetworkSegmentIndex(deploymentName))
      .tap(networkSegmentIndex => logger.info(`+-> Found network segment index '${networkSegmentIndex}'`));
  }

  getDeploymentNames(queued) {
    return this.director.getDeploymentNames(queued);
  }

  getTask(taskId) {
    logger.info(`Fetching task '${taskId}'...`);
    return this.director
      .getTask(taskId)
      .tap(task => logger.info(`+-> Fetched task for deployment '${task.deployment}' has state '${task.state}'`))
      .catch(err => {
        logger.error('+-> Failed to fetch task');
        logger.error(err);
        throw err;
      });
  }

  getDeploymentManifest(deploymentName) {
    logger.info(`Fetching deployment manifest '${deploymentName}'...`);
    return this.director
      .getDeploymentManifest(deploymentName)
      .tap(() => logger.info('+-> Fetched deployment manifest'))
      .catch(err => {
        logger.error('+-> Failed to fetch deployment manifest');
        logger.error(err);
        throw err;
      });
  }

  getDeploymentIps(deploymentName) {
    return this.director.getDeploymentIps(deploymentName);
  }

  findDeploymentTask(deploymentName) {
    return this.director
      .getTasks({
        deployment: deploymentName
      })
      .then(tasks => _
        .chain(tasks)
        .sortBy('id')
        .find(task => /^create\s+deployment/.test(task.description))
        .value()
      );
  }

  getDeploymentInfo(deploymentName) {
    const events = {};
    const info = {};

    function DeploymentDoesNotExist(err) {
      return err.status === 404 && _.get(err, 'error.code') === 70000;
    }

    function addInfoEvent(event) {
      if (!_.has(events, event.stage)) {
        events[event.stage] = {
          tags: event.tags,
          total: event.total,
        };
      }
      if (!_.has(events[event.stage], event.task)) {
        events[event.stage][event.task] = {
          index: event.index,
          time: event.time,
          status: event.state
        };
      } else {
        events[event.stage][event.task].status = event.state;
        let seconds = event.time - events[event.stage][event.task].time;
        delete events[event.stage][event.task].time;
        events[event.stage][event.task].duration = `${seconds} sec`;
      }
    }

    return this
      .findDeploymentTask(deploymentName)
      .tap(task => _.assign(info, task))
      .then(task => this.director.getTaskEvents(task.id))
      .tap(events => _.each(events, addInfoEvent))
      .return(_.set(info, 'events', events))
      .catchReturn(DeploymentDoesNotExist, null);
  }


  getServiceFabrikOperationState(name, opts) {
    logger.info(`Retrieving state of last service fabrik operation '${name}' with:`, opts);
    return Promise
      .try(() => {
        switch (name) {
        case 'backup':
          return this.getBackupOperationState(opts);
        case 'restore':
          return this.getRestoreOperationState(opts);
        }
        throw new BadRequest(`Invalid service fabrik operation '${name}'`);
      })
      .then(result => {
        const deploymentName = opts.deployment;
        const action = _.capitalize(name);
        const timestamp = result.updated_at;
        switch (result.state) {
        case 'succeeded':
          return {
            description: `${action} deployment ${deploymentName} succeeded at ${timestamp}`,
            state: 'succeeded'
          };
        case 'aborted':
          return {
            description: `${action} deployment ${deploymentName} aborted at ${timestamp}`,
            state: 'failed'
          };
        case 'failed':
          return {
            description: `${action} deployment ${deploymentName} failed at ${timestamp} with Error "${result.stage}"`,
            state: 'failed'
          };
        default:
          return {
            description: `${action} deployment ${deploymentName} is still in progress: "${result.stage}"`,
            state: 'in progress'
          };
        }
      });
  }

  getServiceInstanceState(instanceGuid) {
    return this
      .findNetworkSegmentIndex(instanceGuid)
      .then(networkSegmentIndex => this.getDeploymentName(instanceGuid, networkSegmentIndex))
      .then(deploymentName => this.getDeploymentIps(deploymentName))
      .then(ips => this.agent.getState(ips));
  }

  getLockProperty(deploymentName) {
    return this.director.getLockProperty(deploymentName);
  }

  verifyDeploymentLockStatus(deploymentName) {
    return this
      .getLockProperty(deploymentName)
      .then(lockInfo => {
        if (!lockInfo) {
          return;
        }
        throw new errors.DeploymentAlreadyLocked(deploymentName, lockInfo);
      });
  }

  releaseLock(deploymentName) {
    return this.director
      .deleteDeploymentProperty(deploymentName, CONST.DEPLOYMENT_LOCK_NAME);
  }

  acquireLock(deploymentName, lockMetaInfo) {
    return Promise
      .try(() => {
        if (!_.get(lockMetaInfo, 'username') || !_.get(lockMetaInfo, 'lockForOperation')) {
          const msg = `Lock cannot be acquired on deployment ${deploymentName} as (username | lockForOperation) is empty in lockMetaInfo`;
          logger.error(msg, lockMetaInfo);
          throw new errors.BadRequest(msg);
        }
        if (!_.get(lockMetaInfo, 'createdAt')) {
          _.set(lockMetaInfo, 'createdAt', new Date());
        }
        logger.info(`Acquiring lock on deployment ${deploymentName} - lock meta : ${JSON.stringify(lockMetaInfo)}`);
        return this.director
          .updateOrCreateDeploymentProperty(deploymentName, CONST.DEPLOYMENT_LOCK_NAME, JSON.stringify(lockMetaInfo));
      });
  }

  unlock(opts) {
    const responseMessage = _.get(opts, 'arguments.description') || `Unlocked deployment ${opts.deployment}`;
    const response = {
      description: responseMessage
    };
    return this
      .releaseLock(opts.deployment)
      .then(() => response)
      .catch((errors.NotFound), () => {
        logger.info(`Lock already released from deployment - ${opts.deployment}`);
        return response;
      });
  }

  startBackup(opts) {
    const deploymentName = opts.deployment;
    const args = opts.arguments;

    const backup = _
      .chain(opts)
      .pick('guid')
      .assign({
        type: _.get(args, 'type', 'online'),
        secret: undefined,
        trigger: _.get(args, 'trigger', CONST.BACKUP.TRIGGER.ON_DEMAND)
      })
      .value();
    const backupStartedAt = new Date().toISOString();
    const data = _
      .chain(opts)
      .pick('service_id', 'plan_id', 'organization_guid', 'instance_guid', 'username')
      .assign({
        operation: 'backup',
        type: backup.type,
        backup_guid: backup.guid,
        trigger: backup.trigger,
        state: 'processing',
        secret: undefined,
        agent_ip: undefined,
        started_at: backupStartedAt,
        finished_at: null,
        tenant_id: opts.context ? this.getTenantGuid(opts.context) : args.space_guid
      })
      .value();

    const result = _
      .chain(opts)
      .pick('deployment')
      .assign({
        subtype: 'backup',
        backup_guid: backup.guid,
        agent_ip: undefined,
        tenant_id: opts.context ? this.getTenantGuid(opts.context) : args.space_guid,
        description: `${backup.trigger} backup triggerred by ${data.username} at ${data.started_at}`
      })
      .value();

    function createSecret() {
      return utils
        .randomBytes(12)
        .then(buffer => buffer.toString('base64'));
    }

    function normalizeVm(vm) {
      let vmParams = _.pick(vm, 'cid', 'agent_id', 'job', 'index');
      return _.set(vmParams, 'iaas_vm_metadata.vm_id', config.backup.provider.name === CONST.IAAS.AZURE ? vmParams.agent_id : vmParams.cid);
    }

    // const lockInfo = {
    //   username: data.username,
    //   lockForOperation: `${data.trigger}_${data.operation}`
    // };
    // let lockAcquired = false,
    let metaUpdated = false,
      backupStarted = false;

    return Promise
      .all([
        createSecret(),
        this.getDeploymentIps(deploymentName),
        this.director.getDeploymentVms(deploymentName).map(normalizeVm)
      ])
      .spread((secret, ips, vms) => {
        // set data and backup secret
        logger.info(`Starting backup on - ${deploymentName}. Agent Ips for deployment - `, ips);
        data.secret = backup.secret = secret;
        return this.agent
          .startBackup(ips, backup, vms)
          .then(agent_ip => {
            backupStarted = true;
            // set data and result agent ip
            data.agent_ip = result.agent_ip = agent_ip;
            let put_ret = this.backupStore.putFile(data);
            const val1 = _.chain(data)
              .pick('tenant_id', 'backup_guid', 'instance_guid', 'agent_ip', 'service_id', 'plan_id')
              .set('deployment', deploymentName)
              .set('started_at', backupStartedAt)
              .value()
            const val2 = _.chain({})
              .set('backup_store', result)
              .set('instanceInfo', val1)
              .value()
            logger.info(`Backup is initiated with the options: `, val2);
            return val2
          });
      })
      //.return(result)
      .then((res) => eventmesh.server.updateAnnotationKey(this.name, opts.instance_guid, 'backup', 'default', result.backup_guid, 'result', JSON.stringify(res)))
      .then(() => eventmesh.server.updateAnnotationState(this.name, opts.instance_guid, 'backup', 'default', result.backup_guid, CONST.RESOURCE_STATE.IN_PROGRESS))
      .then(() => eventmesh.server.getAnnotationKey(this.name, opts.instance_guid, 'backup', 'default', result.backup_guid, 'result'))
      .then((etcdData) => JSON.parse(etcdData))
      .then(lockInfo => this.pollAndUpdateResourceState(lockInfo.instanceInfo))
      .catch(err => {
        return Promise
          .try(() => logger.error(`Error during start of backup - backup to be aborted : ${backupStarted} - backup to be deleted: ${metaUpdated}`, err))
          .tap(() => {
            if (backupStarted) {
              logger.error(`Error occurred during backup process. Aborting backup on deployment : ${deploymentName}`);
              return this
                .abortLastBackup(this.getTenantGuid(data.context), data.instance_guid, true)
                .finally(() => {
                  if (metaUpdated) {
                    const options = _
                      .chain(data)
                      .pick(data, 'tenant_id', 'backup_guid')
                      .set('force', true)
                      .value();
                    logger.error(`Error occurred during backup process. Deleting backup file on deployment : ${deploymentName} - backup file:`, options);
                    return this.backupStore
                      .deleteBackupFile(options);
                  }
                })
                .catch((err) => logger.error('Error occurred while performing clean up of backup failure operation : ', err));
            }
          }).then(() => {
            throw err;
          });
      });
  }

  pollAndUpdateResourceState(instanceInfo) {
    logger.info('Polling for backup every 10 sec');
    return Promise.delay(10000)
      .then(() => this.getServiceFabrikOperationState('backup', instanceInfo))
      .then(res => {
        return eventmesh.server.updateAnnotationKey('director', instanceInfo.instance_guid, 'backup', 'default', instanceInfo.backup_guid, 'result', JSON.stringify(res))
          .then(() => res);
      })
      .then(res => {
        logger.info('poller output', res);
        if (res.state !== 'succeeded') {
          return this.pollAndUpdateResourceState(instanceInfo);
        } else {
          logger.info('backup succeeded');
          return eventmesh.server.updateAnnotationState('director', instanceInfo.instance_guid, 'backup', 'default', instanceInfo.backup_guid, CONST.RESOURCE_STATE.SUCCEEDED);
        }
      });
  }

  getBackupOperationState(opts) {
    const agent_ip = opts.agent_ip;
    const options = _.assign({
      service_id: this.service.id,
      plan_id: this.plan.id,
      tenant_id: opts.context ? this.getTenantGuid(opts.context) : opts.tenant_id
    }, opts);

    function isFinished(state) {
      return _.includes(['succeeded', 'failed', 'aborted'], state);
    }

    return this.agent
      .getBackupLastOperation(agent_ip)
      .tap(lastOperation => {
        if (isFinished(lastOperation.state)) {
          return this.agent
            .getBackupLogs(agent_ip)
            .tap(logs => _.each(logs, log => logger.info(`Backup log for: ${opts.instance_guid} - ${JSON.stringify(log)}`)))
            .then(logs => this.backupStore
              .patchBackupFile(options, {
                state: lastOperation.state,
                logs: logs,
                snapshotId: lastOperation.snapshotId
              })
            );
        }
      });
  }

  getLastBackup(tenant_id, instance_guid, noCache) {
    return this.backupStore
      .getBackupFile({
        tenant_id: tenant_id,
        service_id: this.service.id,
        plan_id: this.plan.id,
        instance_guid: instance_guid
      })
      .then(metadata => {
        switch (metadata.state) {
        case 'processing':
          return noCache ? this.agent
            .getBackupLastOperation(metadata.agent_ip)
            .then(data => _.assign(metadata, _.pick(data, 'state', 'stage'))) : metadata;
        default:
          return metadata;
        }
      });
  }

  abortLastBackup(tenant_id, instance_guid, force) {
    return this.backupStore
      .getBackupFile({
        tenant_id: tenant_id,
        service_id: this.service.id,
        plan_id: this.plan.id,
        instance_guid: instance_guid
      })
      .then(metadata => {
        if (!force && metadata.trigger === CONST.BACKUP.TRIGGER.SCHEDULED) {
          throw new Forbidden('System scheduled backup runs cannot be aborted');
        }
        switch (metadata.state) {
        case 'processing':
          return this.agent
            .abortBackup(metadata.agent_ip)
            .return({
              state: 'aborting'
            });
        default:
          return _.pick(metadata, 'state');
        }
      });
  }

  verifyFeatureSupport(feature) {
    if (!_.includes(this.agent.features, feature)) {
      throw new NotImplemented(`Feature '${feature}' not supported`);
    }
  }

  static get prefix() {
    return _
      .reduce(config.directors,
        (prefix, director) => director.primary === true ? director.prefix : prefix,
        null) || super.prefix;
  }

  static get instanceConstructor() {
    return DirectorInstance;
  }

  static parseDeploymentName(deploymentName, subnet) {
    return _
      .chain(utils.deploymentNameRegExp(subnet).exec(deploymentName))
      .slice(1)
      .tap(parts => parts[1] = parts.length ? parseInt(parts[1]) : undefined)
      .value();
  }
}

module.exports = DirectorManager;
