'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const config = require('../../common/config');
const utils = require('../../common/utils');
const HttpClient = utils.HttpClient;
const ResourceStream = require('./ResourceStream');
const logger = require('../../common/logger');
const errors = require('../../common/errors');
const ServiceInstanceNotFound = errors.ServiceInstanceNotFound;
const SecurityGroupNotFound = errors.SecurityGroupNotFound;
const ServiceBrokerNotFound = errors.ServiceBrokerNotFound;
const NotFound = errors.NotFound;

class CloudControllerClient extends HttpClient {
  constructor(tokenIssuer) {
    super({
      baseUrl: config.cf.url,
      auth: {
        user: config.cf.username,
        pass: config.cf.password
      },
      headers: {
        Accept: 'application/json'
      },
      followRedirect: false,
      rejectUnauthorized: !config.skip_ssl_validation
    });
    this.tokenIssuer = tokenIssuer;
    this.apiVersion = undefined;
  }

  getApiVersion() {
    return Promise
      .try(() =>
        this.apiVersion ?
        this.apiVersion :
        this.getInfo().then(info => (this.apiVersion = info.api_version))
      );
  }

  getInfo() {
    return this
      .request({
        method: 'GET',
        url: '/v2/info',
        auth: undefined,
        json: true
      }, 200)
      .then(res => res.body);
  }

  createServiceInstanceStream(options) {
    return this.createResourceStream('/v2/service_instances', options);
  }

  getServiceInstances(options) {
    return this.createServiceInstanceStream(options).all();
  }

  getServiceInstancesInOrgWithPlansGuids(orgId, planGuids) {
    let commaSeparatedPlanGuids = _.join(planGuids, ',');
    return this.getServiceInstances({
      qs: {
        q: [`organization_guid:${orgId}`, `service_plan_guid IN ${commaSeparatedPlanGuids}`]
      }
    });
  }

  getServiceInstance(guid, options) {
    return this.getResource(`/v2/service_instances/${guid}`, options);
  }

  getServiceInstanceByName(name, space_guid) {
    return this.getServiceInstances({
        qs: {
          q: [`space_guid:${space_guid}`, `name:${name}`]
        }
      })
      .then(serviceInstances => {
        if (serviceInstances.length < 1) {
          logger.error(`Service instance with name ${name} not found in the space ${space_guid}`);
          throw new NotFound(`Service instance with name ${name} not found`);
        }
        return serviceInstances[0];
      });
  }

  updateServiceInstance(instance_id, options) {
    options = options || {};
    const auth = options.auth || {};
    const parameters = options.parameters || null;
    const expectedResponseCode = options.isOperationSync ? 201 : 202;
    //CC returns 201 for SYNC and 202 for ASYNC operations.
    return Promise
      .try(() => auth.bearer || this.tokenIssuer.getAccessToken())
      .then(accessToken => this
        .request({
          method: 'PUT',
          url: `/v2/service_instances/${instance_id}`,
          auth: {
            bearer: accessToken
          },
          qs: {
            accepts_incomplete: true
          },
          body: {
            parameters: parameters
          },
          json: true
        }, expectedResponseCode)
      )
      .then(res => res.body);
  }

  getServiceInstancePermissions(guid, options) {
    return this.getResource(`/v2/service_instances/${guid}/permissions`, options);
  }

  createServicePlanStream(options) {
    return this.createResourceStream('/v2/service_plans', options);
  }

  getServicePlans(options) {
    return this.createServicePlanStream(options).all();
  }

  getPlanIdFromInstanceId(instance_id) {
    return this.findServicePlanByInstanceId(instance_id)
      .then(planDetails => planDetails.entity.unique_id);
  }

  findServicePlanByInstanceId(instance_id) {
    return this
      .getServicePlans(`service_instance_guid:${instance_id}`)
      .then(resources => {
        if (resources.length) {
          return resources[0];
        }
        throw new ServiceInstanceNotFound(instance_id);
      });
  }

  getServicePlan(guid, options) {
    return this.getResource(`/v2/service_plans/${guid}`, options);
  }

  createSecurityGroupStream(options) {
    return this.createResourceStream('/v2/security_groups', options);
  }

  getSecurityGroups(options) {
    return this.createSecurityGroupStream(options).all();
  }

  findSecurityGroupByName(name) {
    return this
      .getSecurityGroups(`name:${name}`)
      .then(resources => {
        if (resources.length) {
          return resources[0];
        }
        throw new SecurityGroupNotFound(name);
      });
  }

  createSecurityGroup(name, rules, space_guid) {
    const body = {
      name: name,
      rules: rules
    };
    if (_.isString(space_guid)) {
      body.space_guids = [space_guid];
    }
    if (_.isArray(space_guid)) {
      body.space_guids = space_guid;
    }
    return this.tokenIssuer
      .getAccessToken()
      .then(accessToken => this
        .request({
          method: 'POST',
          url: '/v2/security_groups',
          auth: {
            bearer: accessToken
          },
          json: true,
          body: body
        }, 201)
        .then(res => res.body)
      );
  }

  getSecurityGroup(guid, options) {
    return this.getResource(`/v2/security_groups/${guid}`, options);
  }

  deleteSecurityGroup(guid) {
    return this.tokenIssuer
      .getAccessToken()
      .then(accessToken => this
        .request({
          method: 'DELETE',
          url: `/v2/security_groups/${guid}`,
          auth: {
            bearer: accessToken
          },
          json: true,
          qs: {
            async: false
          }
        }, 204)
        .return()
      );
  }

  createServiceBrokerStream(options) {
    return this.createResourceStream('/v2/service_brokers', options);
  }

  getServiceBrokers(options) {
    return this.createServiceBrokerStream(options).all();
  }

  findServiceBrokerByName(name) {
    return this
      .getServiceBrokers(`name:${name}`)
      .then(resources => {
        if (resources.length) {
          return resources[0];
        }
        throw new ServiceBrokerNotFound(name);
      });
  }

  createSpaceDeveloperStream(space_guid, options) {
    return this.createResourceStream(`/v2/spaces/${space_guid}/developers`, options);
  }

  getSpaceDevelopers(space_guid, options) {
    return this.createSpaceDeveloperStream(space_guid, options).all();
  }

  createSpaceStream(options) {
    return this.createResourceStream('/v2/spaces', options);
  }

  getSpaces(options) {
    return this.createSpaceStream(options).all();
  }

  getSpace(space_guid, options) {
    return this.getResource(`/v2/spaces/${space_guid}`, options);
  }

  getOrgAndSpaceGuid(instance_guid, space_guid) {
    return Promise
      .try(() => space_guid ? this.getSpace(space_guid) : this
        .getServiceInstance(instance_guid)
        .then(instance => this.getSpace(instance.entity.space_guid)))
      .then(space => ({
        space_name: space.entity.name,
        space_guid: space.metadata.guid,
        organization_guid: space.entity.organization_guid
      }));
  }

  getOrgAndSpaceDetails(instance_guid, space_guid) {
    return this.getOrgAndSpaceGuid(instance_guid, space_guid)
      .then(space => {
        const data = _
          .chain({})
          .set('space_guid', space.space_guid)
          .set('organization_guid', space.organization_guid)
          .set('space_name', space.space_name)
          .value();
        return this.getOrganization(data.organization_guid)
          .then(org => {
            _.assign(data, {
              organization_name: org.entity.name
            });
            return data;
          });
      });
  }

  createOrganizationStream(options) {
    return this.createResourceStream('/v2/organizations', options);
  }

  getOrganizations(options) {
    return this.createOrganizationStream(options).all();
  }

  getOrganization(org_guid, options) {
    return this.getResource(`/v2/organizations/${org_guid}`, options);
  }

  getResource(pathname, options) {
    if (_.isObject(pathname)) {
      options = pathname;
      pathname = options.url;
    }
    const bearer = _.get(options, 'auth.bearer');
    return Promise
      .try(() => bearer || this.tokenIssuer.getAccessToken())
      .then(bearer => this
        .request({
          method: 'GET',
          url: pathname,
          auth: {
            bearer: bearer
          },
          json: true
        }, 200)
      )
      .then(res => res.body);
  }

  createResourceStream(pathname, options) {
    if (_.isObject(pathname)) {
      options = pathname;
      pathname = options.url;
    }
    if (_.isString(options)) {
      options = _.set({}, 'qs.q', options);
    }
    return new ResourceStream(this, this.tokenIssuer, _
      .chain(options)
      .pick('qs', 'auth')
      .set('url', pathname)
      .value());
  }
}

module.exports = CloudControllerClient;