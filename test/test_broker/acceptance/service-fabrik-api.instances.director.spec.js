'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const moment = require('moment');
const lib = require('../../../broker/lib');
const ScheduleManager = require('../../../broker/lib/jobs');
const CONST = require('../../../broker/lib/constants');
const apps = require('../support/apps');
const catalog = lib.models.catalog;
const config = lib.config;
const errors = lib.errors;
const fabrik = lib.fabrik;
const utils = lib.utils;
const NotFound = errors.NotFound;
const backupStore = lib.iaas.backupStore;
const filename = lib.iaas.backupStore.filename;

describe('service-fabrik-api', function () {

  describe('instances', function () {
    /* jshint expr:true */
    describe('director', function () {
      const base_url = '/api/v1';
      const broker_api_base_url = '/cf/v2';
      const broker_api_version = '2.12';
      const authHeader = `bearer ${mocks.uaa.jwtToken}`;
      const adminAuthHeader = `bearer ${mocks.uaa.adminJwtToken}`;
      const authHeaderInsufficientScopes = `bearer ${mocks.uaa.jwtTokenInsufficientScopes}`;
      const index = mocks.director.networkSegmentIndex;
      const service_id = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
      const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
      const plan_guid = '60750c9c-8937-4caf-9e94-c38cbbbfd191';
      const plan = catalog.getPlan(plan_id);
      const instance_id = mocks.director.uuidByIndex(index);
      const space_guid = 'e7c0a437-7585-4d75-addf-aa4d45b49f3a';
      const organization_guid = 'c84c8e58-eedc-4706-91fb-e8d97b333481';
      const backup_guid = '071acb05-66a3-471b-af3c-8bbf1e4180be';
      const time = Date.now();
      const started_at = isoDate(time);
      const timeAfter = moment(time).add(1, 'seconds').toDate();
      const restore_at = new Date(timeAfter).toISOString().replace(/\.\d*/, '');
      const deployment_name = mocks.director.deploymentNameByIndex(index);
      const username = 'hugo';
      const container = backupStore.containerName;
      const repeatInterval = '*/1 * * * *';
      const repeatTimezone = 'America/New_York';
      const backupOperation = {
        type: 'update',
        subtype: 'backup',
        deployment: deployment_name,
        context: {
          platform: 'cloudfoundry',
          organization_guid: organization_guid,
          space_guid: space_guid
        },
        backup_guid: backup_guid,
        agent_ip: mocks.agent.ip
      };
      const restoreOperation = {
        type: 'update',
        subtype: 'restore',
        deployment: deployment_name,
        context: {
          platform: 'cloudfoundry',
          organization_guid: organization_guid,
          space_guid: space_guid
        },
        agent_ip: mocks.agent.ip
      };

      const getJob = (name, type) => {
        return Promise.resolve({
          name: `${instance_id}_${type === undefined ? CONST.JOB.SCHEDULED_BACKUP : type}`,
          repeatInterval: repeatInterval,
          data: {
            instance_id: instance_id,
            type: 'online'
          },
          nextRunAt: time,
          lastRunAt: time,
          lockedAt: null,
          repeatTimezone: repeatTimezone,
          createdAt: time,
          updatedAt: time,
          createdBy: username,
          updatedBy: username
        });
      };
      let scheduleStub, getScheduleStub, cancelScheduleStub, timestampStub;

      function isoDate(time) {
        return new Date(time).toISOString().replace(/\.\d*/, '').replace(/:/g, '-');
      }

      before(function () {
        config.enable_service_fabrik_v2 = false;
        config.mongodb.provision.plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
        backupStore.cloudProvider = new lib.iaas.CloudProviderClient(config.backup.provider);
        mocks.cloudProvider.auth();
        mocks.cloudProvider.getContainer(container);
        _.unset(fabrik.DirectorManager, plan_id);
        timestampStub = sinon.stub(filename, 'timestamp');
        timestampStub.withArgs().returns(started_at);
        scheduleStub = sinon.stub(ScheduleManager, 'schedule', getJob);
        getScheduleStub = sinon.stub(ScheduleManager, 'getSchedule', getJob);
        cancelScheduleStub = sinon.stub(ScheduleManager, 'cancelSchedule', () => Promise.resolve({}));
        return mocks.setup([
          fabrik.DirectorManager.load(plan),
          backupStore.cloudProvider.getContainer()
        ]);
      });

      afterEach(function () {
        timestampStub.reset();
        cancelScheduleStub.reset();
        scheduleStub.reset();
        getScheduleStub.reset();
        mocks.reset();
      });

      after(function () {
        timestampStub.restore();
        backupStore.cloudProvider = lib.iaas.cloudProvider;
        cancelScheduleStub.restore();
        scheduleStub.restore();
        getScheduleStub.restore();
        delete config.mongodb.provision.plan_id;
      });

      describe('#state', function () {
        it('should return 200 OK', function () {
          const operational = true;
          const details = {
            number_of_files: 5
          };
          mocks.uaa.tokenKey();
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid,
            service_plan_guid: plan_guid
          });
          mocks.cloudController.findServicePlan(instance_id, plan_id);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.director.getDeploymentInstances(deployment_name);
          mocks.agent.getInfo();
          mocks.agent.getState(operational, details);
          return chai.request(apps.external)
            .get(`${base_url}/service_instances/${instance_id}`)
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql({
                operational: operational,
                details: details
              });
              mocks.verify();
            });
        });

        it('should return 403 Forbidden', function () {
          mocks.uaa.tokenKey();
          return chai.request(apps.external)
            .get(`${base_url}/service_instances/${instance_id}`)
            .set('Authorization', authHeaderInsufficientScopes)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(403);
              mocks.verify();
            });
        });
      });
      describe('#unlock-start', function () {
        const name = 'unlock';
        const deploymentName = mocks.director.deploymentNameByIndex(mocks.director.networkSegmentIndex);
        const args = {
          description: `Backup operation for ${deploymentName} finished with status ${CONST.OPERATION.SUCCEEDED}`
        };

        it('should receive the update request from cloud controller and unlock deployment', function () {
          mocks.director.releaseLock();
          return support.jwt
            .sign({
              guid: backup_guid,
              username: username
            }, name)
            .then(token => chai
              .request(apps.internal)
              .patch(`${broker_api_base_url}/service_instances/${instance_id}?accepts_incomplete=true`)
              .send({
                plan_id: plan_id,
                service_id: service_id,
                context: {
                  platform: 'cloudfoundry',
                  organization_guid: organization_guid,
                  space_guid: space_guid
                },
                organization_guid: organization_guid,
                space_guid: space_guid,
                previous_values: {
                  plan_id: plan_id,
                  service_id: service_id
                },
                parameters: {
                  'service-fabrik-operation': token
                }
              })
              .set('X-Broker-API-Version', broker_api_version)
              .auth(config.username, config.password)
              .catch(err => err.response)
              .then(res => {
                expect(res).to.have.status(200);
                const expectedDescription = `Unlocked deployment ${deploymentName}`;
                expect(res.body.description).to.be.eql(expectedDescription);
                mocks.verify();
              })
            );
        });
        it('should receive the update request from cloud controller and if deployment is already unlocked, should return back successfully', function () {
          mocks.director.releaseLock(deploymentName, 404);
          return support.jwt
            .sign({
              guid: backup_guid,
              username: username
            }, name, args)
            .then(token => chai
              .request(apps.internal)
              .patch(`${broker_api_base_url}/service_instances/${instance_id}?accepts_incomplete=true`)
              .send({
                plan_id: plan_id,
                service_id: service_id,
                context: {
                  platform: 'cloudfoundry',
                  organization_guid: organization_guid,
                  space_guid: space_guid
                },
                organization_guid: organization_guid,
                space_guid: space_guid,
                previous_values: {
                  plan_id: plan_id,
                  service_id: service_id
                },
                parameters: {
                  'service-fabrik-operation': token
                }
              })
              .set('X-Broker-API-Version', broker_api_version)
              .auth(config.username, config.password)
              .catch(err => err.response)
              .then(res => {
                expect(res).to.have.status(200);
                expect(res.body.description).to.be.eql(args.description);
                mocks.verify();
              })
            );
        });
      });
      describe('#backup-start', function () {
        const prefix = `${space_guid}/backup/${service_id}.${instance_id}.${backup_guid}`;
        const filename = `${prefix}.${started_at}.json`;
        const pathname = `/${container}/${filename}`;
        const type = 'online';
        const name = 'backup';
        const args = {
          type: type,
          trigger: CONST.BACKUP.TRIGGER.ON_DEMAND
        };
        const list_prefix = `${space_guid}/backup/${service_id}.${instance_id}`;
        const list_filename = `${list_prefix}.${backup_guid}.${started_at}.json`;
        const list_filename2 = `${list_prefix}.${backup_guid}.${isoDate(time + 1)}.json`;
        const list_pathname = `/${container}/${list_filename}`;
        const list_pathname2 = `/${container}/${list_filename2}`;
        const data = {
          trigger: CONST.BACKUP.TRIGGER.ON_DEMAND,
          state: 'succeeded',
          agent_ip: mocks.agent.ip
        };
        const FabrikStatusPoller = require('../../../broker/lib/fabrik/FabrikStatusPoller');
        afterEach(function () {
          FabrikStatusPoller.stopPoller = true;
          FabrikStatusPoller.clearAllPollers();
        });

        it('should recieve 403 forbidden on reaching quota of on-demand backups', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.findServicePlan(instance_id, plan_id);
          mocks.cloudProvider.list(container, list_prefix, [
            list_filename,
            list_filename2
          ]);
          mocks.cloudProvider.download(list_pathname, data);
          mocks.cloudProvider.download(list_pathname2, data);
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid,
            service_plan_guid: plan_guid
          });
          mocks.cloudController.findServicePlan(instance_id, plan_id);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/backup`)
            .set('Authorization', authHeader)
            .set('Accept', 'application/json')
            .send({
              type: type
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(403);
              expect(res.body.description).to.eql(`Reached max quota of ${config.backup.max_num_on_demand_backup} ${CONST.BACKUP.TRIGGER.ON_DEMAND} backups`);
              mocks.verify();
            });
        });

        it('should recieve 403 forbidden for trying to trigger scheduled backup', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid,
            service_plan_guid: plan_guid
          });
          mocks.cloudController.findServicePlan(instance_id, plan_id);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/backup`)
            .set('Authorization', authHeader)
            .set('Accept', 'application/json')
            .send({
              type: type,
              trigger: CONST.BACKUP.TRIGGER.SCHEDULED
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(403);
              expect(res.body.description).to.eql('Scheduled backups can only be initiated by the System User');
              mocks.verify();
            });
        });

        it('should receive the update request from cloud controller and start the backup', function () {
          mocks.director.acquireLock();
          mocks.director.verifyDeploymentLockStatus();
          mocks.director.getDeploymentVms(deployment_name);
          mocks.director.getDeploymentInstances(deployment_name);
          mocks.agent.getInfo();
          mocks.agent.startBackup();
          mocks.cloudProvider.upload(pathname, body => {
            expect(body.type).to.equal(type);
            expect(body.instance_guid).to.equal(instance_id);
            expect(body.username).to.equal(username);
            expect(body.backup_guid).to.equal(backup_guid);
            expect(body.trigger).to.equal(CONST.BACKUP.TRIGGER.ON_DEMAND);
            expect(body.state).to.equal('processing');
            return true;
          });
          mocks.cloudProvider.headObject(pathname);
          return support.jwt
            .sign({
              guid: backup_guid,
              username: username
            }, name, args)
            .then(token => chai
              .request(apps.internal)
              .patch(`${broker_api_base_url}/service_instances/${instance_id}?accepts_incomplete=true`)
              .send({
                plan_id: plan_id,
                service_id: service_id,
                context: {
                  platform: 'cloudfoundry',
                  organization_guid: organization_guid,
                  space_guid: space_guid
                },
                organization_guid: organization_guid,
                space_guid: space_guid,
                previous_values: {
                  plan_id: plan_id,
                  service_id: service_id
                },
                parameters: {
                  'service-fabrik-operation': token
                }
              })
              .set('X-Broker-API-Version', broker_api_version)
              .auth(config.username, config.password)
              .catch(err => err.response)
              .then(res => {
                expect(res).to.have.status(200);
                expect(res.body.description).to.be.defined;
                mocks.verify();
              })
            );
        });

        it('should receive last_operation call from cloud controller while backup is processing', function () {
          const backupState = {
            state: 'processing',
            stage: 'Creating volume',
            updated_at: new Date(Date.now())
          };
          mocks.agent.lastBackupOperation(backupState);
          return chai
            .request(apps.internal)
            .get(`${broker_api_base_url}/service_instances/${instance_id}/last_operation`)
            .set('X-Broker-API-Version', broker_api_version)
            .auth(config.username, config.password)
            .query({
              service_id: service_id,
              plan_id: plan_id,
              operation: utils.encodeBase64(backupOperation)
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body.state).to.equal('in progress');
              expect(res.body).to.have.property('description');
              mocks.verify();
            });
        });

        it('should download the backup logs and update the metadata', function () {
          const state = 'succeeded';
          const backupState = {
            state: state,
            stage: 'Finished',
            updated_at: new Date(Date.now()),
            snapshotId: 'snap-12345678'
          };
          const backupLogs = [{
            time: '2015-11-18T11:28:40+00:00',
            level: 'info',
            msg: 'Creating snapshot ...'
          }, {
            time: '2015-11-18T11:28:42+00:00',
            level: 'info',
            msg: 'Creating volume ...'
          }];
          const backupLogsStream = _
            .chain(backupLogs)
            .map(JSON.stringify)
            .join('\n')
            .value();
          mocks.cloudProvider.list(container, prefix, [filename]);
          mocks.cloudProvider.download(pathname, {});
          mocks.agent.lastBackupOperation(backupState);
          mocks.agent.getBackupLogs(backupLogsStream);
          mocks.cloudProvider.upload(pathname, body => {
            expect(body.logs).to.eql(backupLogs);
            expect(body.state).to.equal(state);
            expect(body.snapshotId).to.equal(backupState.snapshotId);
            expect(body.finished_at).to.not.be.undefined;
            return true;
          });
          mocks.cloudProvider.headObject(pathname);
          return chai
            .request(apps.internal)
            .get(`${broker_api_base_url}/service_instances/${instance_id}/last_operation`)
            .set('X-Broker-API-Version', broker_api_version)
            .auth(config.username, config.password)
            .query({
              service_id: service_id,
              plan_id: plan_id,
              operation: utils.encodeBase64(backupOperation)
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body.state).to.equal(state);
              expect(res.body).to.have.property('description');
              mocks.verify();
            });
        });
      });

      describe('#restore-start', function () {
        const restorePrefix = `${space_guid}/restore/${service_id}.${instance_id}`;
        const backupPrefix = `${space_guid}/backup`;
        const backupPrefix1 = `${backupPrefix}/${service_id}.${instance_id}`;
        const restoreFilename = `${restorePrefix}.json`;
        const backupFilename = `${backupPrefix}/${service_id}.${instance_id}.${backup_guid}.${started_at}.json`;
        const restorePathname = `/${container}/${restoreFilename}`;
        const backupPathname = `/${container}/${backupFilename}`;
        const name = 'restore';
        const backupMetadata = {
          plan_id: plan_id,
          state: 'succeeded',
          type: 'online',
          secret: 'hugo'
        };
        const args = {
          backup_guid: backup_guid,
          backup: _.pick(backupMetadata, 'type', 'secret')
        };

        it('should return 400 Bad Request (no backup_guid or time_stamp given)', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid,
            service_plan_guid: plan_guid
          });
          mocks.cloudController.findServicePlan(instance_id, plan_id);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/restore`)
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(400);
              mocks.verify();
            });
        });

        it('should return 400 Bad Request (invalid backup_guid given)', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid,
            service_plan_guid: plan_guid
          });
          mocks.cloudController.findServicePlan(instance_id, plan_id);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/restore`)
            .send({
              backup_guid: 'invalid-guid'
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(400);
              mocks.verify();
            });
        });

        it('should return 400 Bad Request (invalid time_stamp given)', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid,
            service_plan_guid: plan_guid
          });
          mocks.cloudController.findServicePlan(instance_id, plan_id);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/restore`)
            .send({
              time_stamp: '2017-12-04T07:560:02.203Z'
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(400);
              mocks.verify();
            });
        });

        it('should return 422 Unprocessable Entity (no backup with this guid found)', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid,
            service_plan_guid: plan_guid
          });
          mocks.cloudController.findServicePlan(instance_id, plan_id);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.list(container, backupPrefix, []);
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/restore`)
            .send({
              backup_guid: backup_guid
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(422);
              mocks.verify();
            });
        });

        it('should return 422 Unprocessable Entity (no backup found before given time_stamp)', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid,
            service_plan_guid: plan_guid
          });
          mocks.cloudController.findServicePlan(instance_id, plan_id);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.list(container, backupPrefix1, []);
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/restore`)
            .send({
              time_stamp: restore_at
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(422);
              mocks.verify();
            });
        });

        it('should return 422 Unprocessable Entity (backup still in progress)', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid,
            service_plan_guid: plan_guid
          });
          mocks.cloudController.findServicePlan(instance_id, plan_id);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.list(container, backupPrefix, [backupFilename]);
          mocks.cloudProvider.download(backupPathname, {
            state: 'processing'
          });
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/restore`)
            .send({
              backup_guid: backup_guid
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(422);
              mocks.verify();
            });
        });

        it('should return 422 Unprocessable Entity PITR based (backup still in progress)', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid,
            service_plan_guid: plan_guid
          });
          mocks.cloudController.findServicePlan(instance_id, plan_id);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.list(container, backupPrefix1, [backupFilename]);
          mocks.cloudProvider.download(backupPathname, {
            state: 'processing'
          });
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/restore`)
            .send({
              time_stamp: restore_at
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(422);
              mocks.verify();
            });
        });

        it('should return 422 Unprocessable Entity (plan ids do not match)', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid,
            service_plan_guid: plan_guid
          });
          mocks.cloudController.findServicePlan(instance_id, plan_id);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.list(container, backupPrefix, [backupFilename]);
          mocks.cloudProvider.download(backupPathname, {
            plan_id: 'some-other-plan-id'
          });
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/restore`)
            .send({
              backup_guid: backup_guid
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(422);
              mocks.verify();
            });
        });

        it('should return 422 Unprocessable Entity PITR based (plan ids do not match)', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid,
            service_plan_guid: plan_guid
          });
          mocks.cloudController.findServicePlan(instance_id, plan_id);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.list(container, backupPrefix1, [backupFilename]);
          mocks.cloudProvider.download(backupPathname, {
            plan_id: 'some-other-plan-id'
          });
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/restore`)
            .send({
              time_stamp: restore_at
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(422);
              mocks.verify();
            });
        });

        it('should initiate a start-restore operation at cloud controller via a service instance update', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid,
            service_plan_guid: plan_guid
          });
          mocks.cloudController.findServicePlan(instance_id, plan_id);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.list(container, backupPrefix, [backupFilename]);
          mocks.cloudProvider.download(backupPathname, backupMetadata);
          mocks.cloudController.updateServiceInstance(instance_id, body => {
            const token = _.get(body.parameters, 'service-fabrik-operation');
            return support.jwt.verify(token, name, args);
          });
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/restore`)
            .set('Authorization', authHeader)
            .send({
              backup_guid: backup_guid
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(202);
              expect(res.body).to.have.property('guid');
              mocks.verify();
            });
        });

        it('should initiate a start-restore operation at cloud controller via a service instance update:PITR', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid,
            service_plan_guid: plan_guid
          });
          mocks.cloudController.findServicePlan(instance_id, plan_id);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.list(container, backupPrefix1, [backupFilename]);
          mocks.cloudProvider.download(backupPathname, backupMetadata);
          mocks.cloudController.updateServiceInstance(instance_id, body => {
            const token = _.get(body.parameters, 'service-fabrik-operation');
            return support.jwt.verify(token, name, args);
          });
          return chai
            .request(apps.external)
            .post(`${base_url}/service_instances/${instance_id}/restore`)
            .set('Authorization', authHeader)
            .send({
              time_stamp: restore_at
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(202);
              expect(res.body).to.have.property('guid');
              mocks.verify();
            });
        });

        it('should receive the update request from cloud controller and start the restore', function () {
          mocks.director.getDeploymentVms(deployment_name);
          mocks.director.getDeploymentInstances(deployment_name);
          mocks.director.verifyDeploymentLockStatus();
          mocks.agent.getInfo();
          mocks.agent.startRestore();
          mocks.cloudProvider.upload(restorePathname, body => {
            expect(body.instance_guid).to.equal(instance_id);
            expect(body.username).to.equal(username);
            expect(body.backup_guid).to.equal(backup_guid);
            expect(body.state).to.equal('processing');
            return true;
          });
          mocks.cloudProvider.headObject(restorePathname);
          return support.jwt
            .sign({
              username: username
            }, name, args)
            .then(token => chai
              .request(apps.internal)
              .patch(`${broker_api_base_url}/service_instances/${instance_id}?accepts_incomplete=true`)
              .send({
                plan_id: plan_id,
                service_id: service_id,
                context: {
                  platform: 'cloudfoundry',
                  organization_guid: organization_guid,
                  space_guid: space_guid
                },
                organization_guid: organization_guid,
                space_guid: space_guid,
                previous_values: {
                  plan_id: plan_id,
                  service_id: service_id
                },
                parameters: {
                  'service-fabrik-operation': token
                }
              })
              .set('X-Broker-API-Version', broker_api_version)
              .auth(config.username, config.password)
              .catch(err => err.response)
              .then(res => {
                expect(res).to.have.status(202);
                expect(res.body).to.have.property('operation');
                const operation = utils.decodeBase64(res.body.operation);
                expect(operation.type).to.equal('update');
                expect(operation.subtype).to.equal('restore');
                expect(operation).to.have.property('agent_ip');
                mocks.verify();
              })
            );
        });

        it('should receive last_operation call from cloud controller while restore is processing', function () {
          const restoreState = {
            state: 'processing',
            stage: 'Attaching volume',
            updated_at: new Date(Date.now())
          };
          mocks.agent.lastRestoreOperation(restoreState);
          return chai
            .request(apps.internal)
            .get(`${broker_api_base_url}/service_instances/${instance_id}/last_operation`)
            .set('X-Broker-API-Version', broker_api_version)
            .auth(config.username, config.password)
            .query({
              service_id: service_id,
              plan_id: plan_id,
              operation: utils.encodeBase64(restoreOperation)
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body.state).to.equal('in progress');
              expect(res.body).to.have.property('description');
              mocks.verify();
            });
        });

        it('should download the restore logs and update the metadata', function () {
          const state = 'succeeded';
          const restoreState = {
            state: state,
            stage: 'Finished',
            updated_at: new Date(Date.now())
          };
          const restoreLogs = [{
            time: '2015-11-18T11:28:40+00:00',
            level: 'info',
            msg: 'Downloading tarball ...'
          }, {
            time: '2015-11-18T11:28:42+00:00',
            level: 'info',
            msg: 'Extracting tarball ...'
          }];
          const restoreLogsStream = _
            .chain(restoreLogs)
            .map(JSON.stringify)
            .join('\n')
            .value();
          mocks.cloudProvider.download(restorePathname, {});
          mocks.agent.lastRestoreOperation(restoreState);
          mocks.agent.getRestoreLogs(restoreLogsStream);
          mocks.cloudProvider.upload(restorePathname, body => {
            expect(body.logs).to.eql(restoreLogs);
            expect(body.state).to.equal(state);
            expect(body.finished_at).to.not.be.undefined;
            return true;
          });
          mocks.cloudProvider.headObject(restorePathname);
          return chai
            .request(apps.internal)
            .get(`${broker_api_base_url}/service_instances/${instance_id}/last_operation`)
            .set('X-Broker-API-Version', broker_api_version)
            .auth(config.username, config.password)
            .query({
              service_id: service_id,
              plan_id: plan_id,
              operation: utils.encodeBase64(restoreOperation)
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body.state).to.equal(state);
              expect(res.body).to.have.property('description');
              mocks.verify();
            });
        });
      });

      describe('#restore-state', function () {
        const prefix = `${space_guid}/restore/${service_id}.${instance_id}`;
        const filename = `${prefix}.json`;
        const pathname = `/${container}/${filename}`;
        const data = {
          state: 'processing',
          agent_ip: mocks.agent.ip
        };
        const restoreState = {
          state: 'processing',
          stage: 'Downloading tarball',
          updated_at: new Date(Date.now())
        };

        it('should return 200 Ok', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid,
            service_plan_guid: plan_guid
          });
          mocks.cloudController.findServicePlan(instance_id, plan_id);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.download(pathname, data);
          mocks.agent.lastRestoreOperation(restoreState);
          return chai.request(apps.external)
            .get(`${base_url}/service_instances/${instance_id}/restore`)
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql(_.merge(data, _.pick(restoreState, 'state', 'stage')));
              mocks.verify();
            });
        });

        it('should return 404 Not Found', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid,
            service_plan_guid: plan_guid
          });
          mocks.cloudController.findServicePlan(instance_id, plan_id);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.download(pathname, new NotFound('not found'));
          return chai.request(apps.external)
            .get(`${base_url}/service_instances/${instance_id}/restore`)
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(404);
              expect(res.body).to.eql({});
              mocks.verify();
            });
        });
      });

      describe('#restore-abort', function () {
        const prefix = `${space_guid}/restore/${service_id}.${instance_id}`;
        const filename = `${prefix}.json`;
        const pathname = `/${container}/${filename}`;
        const data = {
          state: 'processing',
          agent_ip: mocks.agent.ip
        };

        it('should return 202 Accepted', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid,
            service_plan_guid: plan_guid
          });
          mocks.cloudController.findServicePlan(instance_id, plan_id);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.download(pathname, _
            .chain(data)
            .omit('state')
            .set('state', 'processing')
            .value()
          );
          mocks.agent.abortRestore();
          return chai
            .request(apps.external)
            .delete(`${base_url}/service_instances/${instance_id}/restore`)
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(202);
              expect(res.body).to.be.empty;
              mocks.verify();
            });
        });
        it('should return 200 OK', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid,
            service_plan_guid: plan_guid
          });
          mocks.cloudController.findServicePlan(instance_id, plan_id);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.download(pathname, _
            .chain(data)
            .omit('state')
            .set('state', 'succeeded')
            .value()
          );
          return chai
            .request(apps.external)
            .delete(`${base_url}/service_instances/${instance_id}/restore`)
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.be.empty;
              mocks.verify();
            });
        });
      });

      describe('#listLastBackups', function () {
        const prefix = `${space_guid}/backup/${service_id}`;
        const filename1 = `${prefix}.${instance_id}.${backup_guid}.${started_at}.json`;
        const filename2 = `${prefix}.${instance_id}.${backup_guid}.${isoDate(time + 1)}.json`;
        const filename3 = `${prefix}.${instance_id}.${backup_guid}.${isoDate(time + 2)}.json`;
        const pathname3 = `/${container}/${filename3}`;
        const data = {
          trigger: CONST.BACKUP.TRIGGER.ON_DEMAND,
          state: 'processing',
          agent_ip: mocks.agent.ip,
          logs: []
        };

        it('should return 200 OK', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.list(container, prefix, [
            filename1,
            filename2,
            filename3
          ]);
          mocks.cloudProvider.download(pathname3, data);
          return chai
            .request(apps.external)
            .get(`${base_url}/service_instances/backup`)
            .query({
              space_guid: space_guid,
              service_id: service_id
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              const body = [_.omit(data, 'agent_ip', 'logs')];
              expect(res.body).to.eql(body);
              mocks.verify();
            });
        });
      });

      describe('#listLastRestores', function () {
        const instance_id2 = 'fff659f7-3fb4-4034-aaf3-ab103698f6b0';
        const prefix = `${space_guid}/restore/${service_id}`;
        const filename1 = `${prefix}.${instance_id}.json`;
        const filename2 = `${prefix}.${instance_id2}.json`;
        const pathname1 = `/${container}/${filename1}`;
        const pathname2 = `/${container}/${filename2}`;
        const data = {
          state: 'processing',
          agent_ip: mocks.agent.ip,
          logs: []
        };

        it('should return 200 OK', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.cloudProvider.list(container, prefix, [
            filename1,
            filename2
          ]);
          mocks.cloudProvider.download(pathname1, data);
          mocks.cloudProvider.download(pathname2, data);
          return chai
            .request(apps.external)
            .get(`${base_url}/service_instances/restore`)
            .query({
              space_guid: space_guid,
              service_id: service_id
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              const body = _.omit(data, 'agent_ip', 'logs');
              expect(res.body).to.eql([
                body,
                body
              ]);
              mocks.verify();
            });
        });
      });

      describe('#backup-schedule', function () {
        it('should return 503 - schedule backup feature not enabled', function () {
          const mongourl = config.mongodb.url;
          const mongoprovision = config.mongodb.provision;
          delete config.mongodb.url;
          delete config.mongodb.provision;
          mocks.uaa.tokenKey();
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid,
            service_plan_guid: plan_guid
          });
          mocks.cloudController.findServicePlan(instance_id, plan_id);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          return chai.request(apps.external)
            .put(`${base_url}/service_instances/${instance_id}/schedule_backup`)
            .set('Authorization', authHeader)
            .set('Accept', 'application/json')
            .send({
              type: 'online',
              repeatInterval: '*/1 * * * *'
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(503);
              expect(res.body.description).to.eql(`${CONST.FEATURE.SCHEDULED_BACKUP} feature not enabled`);
              config.mongodb.url = mongourl;
              config.mongodb.provision = mongoprovision;
              mocks.verify();
            });
        });

        it('should return 400 - Bad request on skipping mandatory params', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid,
            service_plan_guid: plan_guid
          });
          mocks.cloudController.findServicePlan(instance_id, plan_id);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          return chai.request(apps.external)
            .put(`${base_url}/service_instances/${instance_id}/schedule_backup`)
            .set('Authorization', authHeader)
            .send({})
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(400);
              expect(res.body).to.eql({});
              mocks.verify();
            });
        });

        it('should return 201 OK', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getServiceInstance(instance_id, {
            service_guid: service_id,
            space_guid: space_guid,
            service_plan_guid: plan_id
          });
          mocks.cloudController.getSpace(space_guid, {
            organization_guid: organization_guid
          });
          mocks.cloudController.getOrganization(organization_guid);
          mocks.cloudController.findServicePlan(instance_id, plan_id);
          mocks.cloudController.getSpaceDevelopers(space_guid);

          return chai.request(apps.external)
            .put(`${base_url}/service_instances/${instance_id}/schedule_backup`)
            .set('Authorization', authHeader)
            .send({
              type: 'online',
              repeatInterval: '*/1 * * * *'
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(201);
              expect(res.body).to.eql(getJob().value());
              mocks.verify();
            });
        });
      });

      describe('#GetBackupSchedule', function () {
        it('should return 503 - schedule backup feature not enabled', function () {
          const mongourl = config.mongodb.url;
          delete config.mongodb.url;
          const mongodbprovision = config.mongodb.provision;
          mocks.uaa.tokenKey();
          delete config.mongodb.provision;
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid,
            service_plan_guid: plan_guid
          });
          mocks.cloudController.findServicePlan(instance_id, plan_id);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          return chai.request(apps.external)
            .get(`${base_url}/service_instances/${instance_id}/schedule_backup`)
            .set('Authorization', authHeader)
            .set('accept', 'application/json')
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(503);
              expect(res.body.description).to.eql(`${CONST.FEATURE.SCHEDULED_BACKUP} feature not enabled`);
              config.mongodb.url = mongourl;
              config.mongodb.provision = mongodbprovision;
              mocks.verify();
            });
        });
        it('should return 200 OK', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid,
            service_plan_guid: plan_guid
          });
          mocks.cloudController.findServicePlan(instance_id, plan_id);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          return chai.request(apps.external)
            .get(`${base_url}/service_instances/${instance_id}/schedule_backup`)
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql(getJob().value());
              mocks.verify();
            });
        });
      });

      describe('#CancelBackupSchedule', function () {
        it('should return 503 - schedule backup feature not enabled', function () {
          const mongourl = config.mongodb.url;
          const mongoprovision = config.mongodb.provision;
          delete config.mongodb.url;
          delete config.mongodb.provision;
          mocks.uaa.tokenKey();
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid,
            service_plan_guid: plan_guid
          });
          mocks.cloudController.findServicePlan(instance_id, plan_id);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          return chai.request(apps.external)
            .delete(`${base_url}/service_instances/${instance_id}/schedule_backup`)
            .set('Authorization', authHeader)
            .set('accept', 'application/json')
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(503);
              expect(res.body.description).to.eql(`${CONST.FEATURE.SCHEDULED_BACKUP} feature not enabled`);
              config.mongodb.url = mongourl;
              config.mongodb.provision = mongoprovision;
              mocks.verify();
            });
        });
        it('should return 200 OK', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid,
            service_plan_guid: plan_guid
          });
          mocks.cloudController.findServicePlan(instance_id, plan_id);
          return chai.request(apps.external)
            .delete(`${base_url}/service_instances/${instance_id}/schedule_backup`)
            .set('Authorization', adminAuthHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql({});
              mocks.verify();
            });
        });
      });

      describe('#schedule-update', function () {
        it('should return 503 - schedule update feature not enabled', function () {
          const mongourl = config.mongodb.url;
          const mongoprovision = config.mongodb.provision;
          delete config.mongodb.url;
          delete config.mongodb.provision;
          mocks.uaa.tokenKey();
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid,
            service_plan_guid: plan_guid
          });
          mocks.cloudController.findServicePlan(instance_id, plan_id);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          return chai.request(apps.external)
            .put(`${base_url}/service_instances/${instance_id}/schedule_update`)
            .set('Authorization', authHeader)
            .set('Accept', 'application/json')
            .send({
              type: 'online',
              repeatInterval: '*/1 * * * *'
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(503);
              expect(res.body.description).to.eql(`${CONST.FEATURE.SCHEDULED_UPDATE} feature not enabled`);
              config.mongodb.url = mongourl;
              config.mongodb.provision = mongoprovision;
              mocks.verify();
            });
        });

        it('should return 400 - Badrequest on skipping mandatory params', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid,
            service_plan_guid: plan_guid
          });
          mocks.cloudController.findServicePlan(instance_id, plan_id);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          return chai.request(apps.external)
            .put(`${base_url}/service_instances/${instance_id}/schedule_update`)
            .set('Authorization', authHeader)
            .send({})
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(400);
              expect(res.body).to.eql({});
              mocks.verify();
            });
        });

        it('should return 201 OK', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid,
            service_plan_guid: plan_guid
          });
          mocks.cloudController.findServicePlan(instance_id, plan_id);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.director.getDeployments();
          return chai.request(apps.external)
            .put(`${base_url}/service_instances/${instance_id}/schedule_update`)
            .set('Authorization', authHeader)
            .send({
              type: 'online',
              repeatInterval: '*/1 * * * *'
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(201);
              expect(res.body).to.eql(getJob(instance_id, CONST.JOB.SERVICE_INSTANCE_UPDATE).value());
              mocks.verify();
            });
        });
        it('should return 201 OK - when rate limiting against bosh is explicitly not required', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid,
            service_plan_guid: plan_guid
          });
          mocks.cloudController.findServicePlan(instance_id, plan_id);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          mocks.director.getDeployments();
          return chai.request(apps.external)
            .put(`${base_url}/service_instances/${instance_id}/schedule_update`)
            .set('Authorization', authHeader)
            .send({
              type: 'online',
              repeatInterval: '*/1 * * * *',
              runImmediately: 'true'
            })
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(201);
              expect(res.body).to.eql(getJob(instance_id, CONST.JOB.SERVICE_INSTANCE_UPDATE).value());
              mocks.verify();
            });
        });
      });
      describe('#GetUpdateSchedule', function () {
        it('should return 200 OK', function () {
          mocks.uaa.tokenKey();
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid,
            service_plan_guid: plan_guid
          });
          mocks.cloudController.findServicePlan(instance_id, plan_id);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          return chai.request(apps.external)
            .get(`${base_url}/service_instances/${instance_id}/schedule_update`)
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              expect(res.body).to.eql(getJob(instance_id, CONST.JOB.SERVICE_INSTANCE_UPDATE).value());
              mocks.verify();
            });
        });
        it('should return update required status if query param check_update_required is provided', function () {
          let deploymentName = 'service-fabrik-0021-b4719e7c-e8d3-4f7f-c515-769ad1c3ebfa';
          mocks.uaa.tokenKey();
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid,
            service_plan_guid: plan_guid
          });
          mocks.cloudController.getServiceInstance(instance_id, {
            space_guid: space_guid
          });
          mocks.cloudController.getSpace(space_guid, {
            organization_guid: organization_guid
          });
          mocks.director.getDeployments();
          mocks.director.getDeployment(deploymentName, true);
          const diff = [
            ['- name: blueprint', null],
            ['  version: 0.0.10', 'removed'],
            ['  version: 0.0.11', 'added']
          ];
          mocks.director.diffDeploymentManifest(1, diff);
          mocks.cloudController.findServicePlan(instance_id, plan_id);
          mocks.cloudController.getSpaceDevelopers(space_guid);
          return chai.request(apps.external)
            .get(`${base_url}/service_instances/${instance_id}/schedule_update`)
            .query({
              check_update_required: true
            })
            .set('Authorization', authHeader)
            .catch(err => err.response)
            .then(res => {
              expect(res).to.have.status(200);
              const expectedJobResponse = getJob(instance_id, CONST.JOB.SERVICE_INSTANCE_UPDATE).value();
              _.set(expectedJobResponse, 'update_required', true);
              _.set(expectedJobResponse, 'update_details', utils.unifyDiffResult({
                diff: diff
              }));
              expect(res.body).to.eql(expectedJobResponse);
              mocks.verify();
            });
        });
      });
    });
  });
});