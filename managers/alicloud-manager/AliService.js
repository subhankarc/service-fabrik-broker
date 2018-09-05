const _ = require('lodash');
const Promise = require('bluebird');
const child_process = require('child_process');
const spawnSync = child_process.spawnSync;
const error = require('../../common/errors');
const InternalServerError = error.InternalServerError;
const ServiceInstanceNotFound = error.ServiceInstanceNotFound;
const logger = require('../../common/logger');
const utils = require('../../common/utils');
const config = require('../../common/config');

class AliService {
    constructor(guid) {
        this.guid = guid;
        this.access_key = config.apsaradb.access_key;
        this.secret_key = config.apsaradb.secret_key;
        this.region = config.apsaradb.region;
    }

    _spawnSync(action, params) {
        const path = '/Users/i341345/gitrepos/sf20/service-fabrik-broker/managers/alicloud-manager/alicloud-apsaradb/main.py';
        const commonParams = {
            access_key: this.access_key,
            secret_key: this.secret_key,
            region: this.region,
            instance_id: this.guid
        };
        const pythonParams = _.chain(commonParams)
            .extend(params)
            .map((value, key) => {
                if (_.isObject(value)) {
                    value = JSON.stringify(value);
                }
                return `--${key}=${value}`;
            })
            .value();
        const spawnParameters = _(path)
            .chain()
            .concat(action, pythonParams)
            .flatten()
            .value();
        logger.info('spawn params are', spawnParameters);
        const cp = spawnSync('python3', spawnParameters, {
            encoding: 'utf8'
        });
        return Promise.try(() => {
            if (cp.stdout !== '') {
                logger.info(`Action ${action} Successful with response`, cp.stdout);
                return JSON.parse(cp.stdout);
            }
            else if (cp.stderr != '') {
                logger.info(`Action ${action} failed with error`, cp.stderr);
                const stderr = JSON.parse(cp.stderr);
                throw new InternalServerError(stderr.error_message);
            }
            else {
                logger.info(`Action ${action} failed with error`, cp.error);
                throw new InternalServerError('Something Unexpected Happened');
            }
        });
    }

    create() {
        const action = 'create-instance';
        const params = {
            vpc_id: config.apsaradb.vpc_id,
            vswitch_id: config.apsaradb.vswitch_id
        };
        return this._spawnSync(action, params)
            .then(response => _.extend(response, { type: 'create' }));
    }

    instanceInfo() {
        const action = 'get-instance-info';
        return this._spawnSync(action)
            .then(response => {
                if (response.DBInstanceStatus === 'Running') {
                    return {
                        'description': `Service instance ${this.guid} creation completed successfully`,
                        'state': 'succeeded',
                        'resourceState': 'succeeded'
                    }
                }
                else {
                    return {
                        'description': `Service instance ${this.guid} creation is in progress`,
                        'state': 'in progress',
                        'resourceState': 'in_progress'
                    }
                }
            })
    }


    prepareInstance() {
        const action = 'prepare-instance';
        const params = {
            account_name: config.apsaradb.account_name,
            account_password: config.apsaradb.account_password,
            db_name: config.apsaradb.db_name
        };
        return utils.retry(tries => {
            logger.info(`+-> Attempt ${tries + 1} to prepare instance ${this.guid}`);
            return this._spawnSync(action, params);
        }, {
                maxAttempts: 5,
                minDelay: 8000
            });
    }

    bindInstance() {
        const action = 'bind-service';
        const params = {
            account_name: config.apsaradb.account_name,
            account_password: config.apsaradb.account_password,
            db_name: config.apsaradb.db_name
        };
        return utils.retry(tries => {
            logger.info(`+-> Attempt ${tries + 1} to bind instance ${this.guid}`);
            return this._spawnSync(action, params);
        }, {
                maxAttempts: 5,
                minDelay: 2000
            });
    }

    unBindInstance(userName) {
        const action = 'unbind-service';
        const params = {
            account_name: config.apsaradb.account_name,
            account_password: config.apsaradb.account_password,
            db_name: config.apsaradb.db_name,
            user: userName
        };
        return utils.retry(tries => {
            logger.info(`+-> Attempt ${tries + 1} to bind instance ${this.guid}`);
            return this._spawnSync(action, params);
        }, {
                maxAttempts: 5,
                minDelay: 2000
            });
    }

    deleteInstance() {
        const action = 'delete-instance';
        return this._spawnSync(action)
            .then(response => _.extend(response, { type: 'delete' }))
            .catchThrow(InternalServerError, new ServiceInstanceNotFound(`Service instance ${this.guid} not found`));
    }

    static createInstance(instanceId, options) {
        const aliService = new AliService(instanceId);
        return Promise.resolve(aliService);
    }

}
module.exports = AliService;