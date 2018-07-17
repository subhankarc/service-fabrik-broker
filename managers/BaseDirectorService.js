'use strict';

const _ = require('lodash');
const utils = require('../common/utils');
const CONST = require('../common/constants');
const bosh = require('../data-access-layer/bosh');
const Agent = require('../data-access-layer/service-agent');
const errors = require('../common/errors');
const BoshDirectorClient = bosh.BoshDirectorClient;
const Networks = bosh.manifest.Networks;
const NotImplemented = errors.NotImplemented;

class BaseDirectorService {
  constructor(plan) {
    this.plan = plan;
    this.director = bosh.director;
    this.agent = new Agent(this.settings.agent);
  }

  get settings() {
    return this.plan.manager.settings;
  }

  static parseDeploymentName(deploymentName, subnet) {
    return _
      .chain(utils.deploymentNameRegExp(subnet).exec(deploymentName))
      .slice(1)
      .tap(parts => parts[1] = parts.length ? parseInt(parts[1]) : undefined)
      .value();
  }

  getTenantGuid(context) {
    if (context.platform === CONST.PLATFORM.CF) {
      return context.space_guid;
    } else if (context.platform === CONST.PLATFORM.K8S) {
      return context.namespace;
    }
  }

  getDeploymentIps(deploymentName) {
    return this.director.getDeploymentIps(deploymentName);
  }

  get service() {
    return this.plan.service;
  }

  get subnet() {
    return this.settings.subnet || this.service.subnet;
  }

  get name() {
    return this.plan.manager.name;
  }

  get updatePredecessors() {
    return this.settings.update_predecessors || [];
  }

  get restorePredecessors() {
    return this.settings.restore_predecessors || this.updatePredecessors;
  }

  isUpdatePossible(plan_id) {
    const previousPlan = _.find(this.service.plans, ['id', plan_id]);
    return this.plan === previousPlan || _.includes(this.updatePredecessors, previousPlan.id);
  }

  isRestorePossible(plan_id) {
    const previousPlan = _.find(this.service.plans, ['id', plan_id]);
    return this.plan === previousPlan || _.includes(this.restorePredecessors, previousPlan.id);
  }

  get async() {
    return true;
  }

  isAutoUpdatePossible() {
    return true;
  }

  get template() {
    return new Buffer(this.settings.template, 'base64').toString('utf8');
  }

  get stemcell() {
    return _(this.settings)
      .chain()
      .get('stemcell', {})
      .defaults(BoshDirectorClient.getInfrastructure().stemcell)
      .update('version', version => '' + version)
      .value();
  }

  get releases() {
    return _(this.settings)
      .chain()
      .get('releases')
      .map(release => _.pick(release, 'name', 'version'))
      .sortBy(release => `${release.name}/${release.version}`)
      .value();
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

  getNetworks(index) {
    return new Networks(BoshDirectorClient.getInfrastructure().networks, index, BoshDirectorClient.getInfrastructure().segmentation);
  }

  getNetwork(index) {
    return this.getNetworks(index)[this.networkName];
  }

  verifyFeatureSupport(feature) {
    if (!_.includes(this.agent.features, feature)) {
      throw new NotImplemented(`Feature '${feature}' not supported`);
    }
  }
}

module.exports = BaseDirectorService;