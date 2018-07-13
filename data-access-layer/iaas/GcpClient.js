'use strict';
const assert = require('assert');
const _ = require('lodash');
const Promise = require('bluebird');
const GcpStorage = require('@google-cloud/storage');
const GcpCompute = require('@google-cloud/compute');
const logger = require('../../common/logger');
const errors = require('../../common/errors');
const utils = require('../../broker/lib/utils');
const BaseCloudClient = require('./BaseCloudClient');
const NotFound = errors.NotFound;
const Unauthorized = errors.Unauthorized;
const Forbidden = errors.Forbidden;
const UnprocessableEntity = errors.UnprocessableEntity;

class GcpClient extends BaseCloudClient {
  constructor(settings) {
    super(settings);
    this.constructor.validateParams(this.settings);
    this.storageClient = this.constructor.createStorageClient(_
      .chain(this.settings)
      .omit('name')
      .set('provider', this.provider)
      .value()
    );
    this.computeClient = this.constructor.createComputeClient(_
      .chain(this.settings)
      .set('provider', this.provider)
      .value()
    );
  }

  getContainer(container) {
    if (arguments.length < 1) {
      container = this.containerName;
    }
    return Promise.try(() =>
      this.storageClient
      .bucket(container)
      .get()
      .then(result => {
        // return the bucket metadata
        return result[1];
      })
    );
  }

  list(container, options) {
    if (arguments.length < 2) {
      options = container;
      container = this.containerName;
    }
    const queryOptions = {};
    if (options && options.prefix) {
      queryOptions.prefix = options.prefix;
    }
    queryOptions.autoPaginate = true;
    return Promise.try(() =>
      this.storageClient
      .bucket(container)
      .getFiles(queryOptions)
      .then(results => {
        return _.get(results, 0, []).map(file => ({
          name: file.name
        }));
      })
    );
  }

  remove(container, file) {
    if (arguments.length < 2) {
      file = container;
      container = this.containerName;
    }
    logger.debug(`Deleting file ${file} in container ${container} `);
    return Promise.try(() =>
        this.storageClient
        .bucket(container)
        .file(file)
        .delete()
        .then(() => logger.info(`Deleted file ${file} in container ${container}`))
      )
      .catchThrow(BaseCloudClient.providerErrorTypes.Unauthorized,
        new Unauthorized(`Authorization at google cloud storage provider failed while deleting blob ${file} in container ${container}`))
      .catchThrow(BaseCloudClient.providerErrorTypes.Forbidden,
        new Forbidden(`Authentication at google cloud storage provider failed while deleting blob ${file} in container ${container}`))
      .catchThrow(BaseCloudClient.providerErrorTypes.NotFound,
        new NotFound(`Object '${file}' not found while deleting in container ${container}`));
  }

  download(options) {
    return utils.streamToPromise(this.storageClient
        .bucket(options.container)
        .file(options.remote)
        .createReadStream())
      .catchThrow(BaseCloudClient.providerErrorTypes.NotFound, new NotFound(`Object '${options.remote}' not found`));
  }

  upload(options, buffer) {
    return new Promise((resolve, reject) => {
      function cleanup() {
        uploadedStream.removeListener('finish', onfinish);
        uploadedStream.removeListener('error', onerror);
      }

      function onerror(err) {
        cleanup();
        reject(err);
      }

      function onfinish() {
        cleanup();
        resolve(JSON.parse(buffer));
      }
      const uploadedStream = this.storageClient
        .bucket(options.container)
        .file(options.remote)
        .createWriteStream();
      uploadedStream.on('error', onerror);
      uploadedStream.on('finish', onfinish);
      uploadedStream.end(buffer);
    });
  }

  uploadJson(container, file, data) {
    if (arguments.length < 3) {
      data = file;
      file = container;
      container = this.containerName;
    }
    return this
      .upload({
        container: container,
        remote: file
      }, new Buffer(JSON.stringify(data, null, 2), 'utf8'));
  }

  downloadJson(container, file) {
    if (arguments.length < 2) {
      file = container;
      container = this.containerName;
    }
    return this
      .download({
        container: container,
        remote: file
      })
      .then((data) => JSON.parse(data))
      .catchThrow(SyntaxError, new UnprocessableEntity(`Object '${file}' data unprocessable`));
  }

  deleteSnapshot(snapshotName) {
    return new Promise((resolve, reject) => {
      function cleanup() {
        deleteOperation.removeAllListeners();
      }

      function onerror(err) {
        cleanup();
        reject(err);
      }

      function oncomplete() {
        cleanup();
        logger.info(`Deleted snapshot ${snapshotName}`);
        resolve();
      }

      var deleteOperation;
      this.computeClient
        .snapshot(snapshotName)
        .delete()
        .then(data => {
          // Returns an Operation object that can be used to check the status of the request.
          // All operations are event emitters. The status of each operation is polled
          // continuously, starting only after you register a "complete" listener.
          // https://cloud.google.com/nodejs/docs/reference/compute/0.9.x/Operation#Operation 
          deleteOperation = data[0];
          deleteOperation.on('complete', oncomplete);
          deleteOperation.on('error', onerror);
        })
        .catch(err => {
          logger.error(`Error occured while deleting snapshot ${snapshotName}`, err);
          reject(err);
        });
    });
  }

  static validateParams(options) {
    if (!options) {
      throw new Error('GcpClient can not be instantiated as backup provider config not found');
    } else {
      if (!options.projectId || !options.credentials) {
        throw new Error('GcpClient can not be instantiated as project id or credentials not found in backup provider config');
      }
      assert.ok(options.credentials.type, `GcpClient can not be instantiated, missing 'type' property in credentials object in backup provider config`);
      assert.ok(options.credentials.project_id, `GcpClient can not be instantiated, missing 'project_id' property in credentials object in backup provider config`);
      assert.ok(options.credentials.private_key_id, `GcpClient can not be instantiated, missing 'private_key_id' property in credentials object in backup provider config`);
      assert.ok(options.credentials.private_key, `GcpClient can not be instantiated, missing 'private_key' property in credentials object in backup provider config`);
      assert.ok(options.credentials.client_email, `GcpClient can not be instantiated, missing 'client_email' property in credentials object in backup provider config`);
      assert.ok(options.credentials.client_id, `GcpClient can not be instantiated, missing 'client_id' property in credentials object in backup provider config`);
      assert.ok(options.credentials.auth_uri, `GcpClient can not be instantiated, missing 'auth_uri' property in credentials object in backup provider config`);
      assert.ok(options.credentials.token_uri, `GcpClient can not be instantiated, missing 'token_uri' property in credentials object in backup provider config`);
      assert.ok(options.credentials.auth_provider_x509_cert_url, `GcpClient can not be instantiated, missing 'auth_provider_x509_cert_url' property in credentials object in backup provider config`);
      assert.ok(options.credentials.client_x509_cert_url, `GcpClient can not be instantiated, missing 'client_x509_cert_url' property in credentials object in backup provider config`);
    }
    return true;
  }

  static createStorageClient(options) {
    return GcpStorage({
      projectId: options.projectId,
      credentials: options.credentials
    });
  }

  static createComputeClient(options) {
    return GcpCompute({
      projectId: options.projectId,
      credentials: options.credentials
    });
  }
}

module.exports = GcpClient;