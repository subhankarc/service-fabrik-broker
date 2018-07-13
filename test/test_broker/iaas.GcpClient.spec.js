'use strict';
const _ = require('lodash');
const GcpStorage = require('@google-cloud/storage');
const GcpCompute = require('@google-cloud/compute');
const Promise = require('bluebird');
const logger = require('../../broker/lib/logger');
const errors = require('../../broker/lib/errors');
const utils = require('../../broker/lib/utils');
const GcpClient = require('../../data-access-layer/iaas').GcpClient;
const NotFound = errors.NotFound;
const Forbidden = errors.Forbidden;
const UnprocessableEntity = errors.UnprocessableEntity;

const CONNECTION_WAIT_SIMULATED_DELAY = 5;
const config = {
  backup: {
    retention_period_in_days: 14,
    max_num_on_demand_backup: 2,
    status_check_every: 120000, // (ms) Check the status of backup once every 2 mins
    backup_restore_status_poller_timeout: 86400000, // (ms) Deployment backup/restore must finish within this timeout time (24 hrs)
    backup_restore_status_check_every: 120000, // (ms) Check the status of deployment backup/restore once every 2 mins
    abort_time_out: 300000, //(ms) Timeout time for abort of backup to complete
    provider: {
      name: 'gcp',
      projectId: 'my-gcp-dev',
      credentials: {
        'type': 'service_account',
        'project_id': 'my-gcp-dev',
        'private_key_id': 'kkkkkkkk',
        'private_key': '-----BEGIN PRIVATE KEY-----\nlllllllllllllllllllllll\n-----END PRIVATE KEY-----\n',
        'client_email': 'my-test-user@my-gcp-dev.iam.myaccounts.com',
        'client_id': '000000000000000',
        'auth_uri': 'https://myaccounts.com/oauth2/auth',
        'token_uri': 'https://myaccounts.com/oauth2/token',
        'auth_provider_x509_cert_url': 'https://myaccounts.com/oauth2/v1/certs',
        'client_x509_cert_url': 'https://myaccounts.com/v1/metadata/x509/my-test-user%40my-gcp-dev.iam.myaccounts.com'
      },
      container: 'sample-container',
      provider: 'gcp'
    }
  }
};
const settings = config.backup.provider;
const storageUrl = 'https://myaccounts.com/storage/v1';
const bucketUrl = '/b';
const region = 'EUROPE-WEST1';
const storageClass = 'REGIONAL';
const bucketMetadataResponse = [{ /* Bucket Object */ },
  {
    kind: 'storage#bucket',
    id: 'sample-container',
    selfLink: 'https://myaccounts.com/storage/v1/b/sample-container',
    projectNumber: '00000000000',
    name: 'sample-container',
    timeCreated: '2017-12-24T10:23:50.348Z',
    updated: '2017-12-24T10:23:50.348Z',
    metageneration: '1',
    location: 'EUROPE-WEST1',
    storageClass: 'REGIONAL',
    etag: 'aaa'
  }
];
const getFilesResponse = [
  [{
      name: 'blob1.txt',
      metadata: {
        kind: 'storage#object',
        id: 'sample-container/blob1.txt/1111111',
        selfLink: 'https://myaccounts.com/storage/v1/b/sample-container/o/blob1.txt',
        name: 'blob1.txt',
        bucket: 'sample-container',
        generation: '1111111',
        metageneration: '1',
        timeCreated: '2018-03-08T14:15:49.655Z',
        updated: '2018-03-08T14:15:49.655Z',
        storageClass: 'REGIONAL',
        timeStorageClassUpdated: '2018-03-08T14:15:49.655Z',
        size: '26877',
        md5Hash: 'aaaaaaa',
        mediaLink: 'https://myaccounts.com/download/storage/v1/b/sample-container/o/blob1.txt?generation=1111111&alt=media',
        crc32c: 'aaa',
        etag: 'bbb'
      }
    },
    {
      name: 'blob2.txt',
      metadata: {
        kind: 'storage#object',
        id: 'sample-container/blob2.txt/222222',
        selfLink: 'https://myaccounts.com/storage/v1/b/sample-container/o/blob2.txt',
        name: 'blob2.txt',
        bucket: 'sample-container',
        generation: '222222',
        metageneration: '1',
        timeCreated: '2018-03-08T14:15:49.655Z',
        updated: '2018-03-08T14:15:49.655Z',
        storageClass: 'REGIONAL',
        timeStorageClassUpdated: '2018-03-08T14:15:49.655Z',
        size: '2687',
        md5Hash: 'bbbbb',
        mediaLink: 'https://myaccounts.com/download/storage/v1/b/sample-container/o/blob2.txt?generation=222222&alt=media',
        crc32c: 'aaa',
        etag: 'bbb'
      }
    }
  ]
];
const deleteFileSuccessResponse = [
  undefined,
  {}
];
const fileNotFoundResponse = {
  ApiError: 'Not Found',
  code: 404,
  errors: [{
    domain: 'global',
    reason: 'notFound',
    message: 'Not Found'
  }],
  response: undefined,
  message: 'Not Found'
};
const fileForbiddenResponse = {
  ApiError: 'my-test-user@my-gcp-dev.iam.myaccounts.com does not have storage.objects.delete access',
  code: 403,
  errors: [{
    domain: 'global',
    reason: 'forbidden',
    message: 'my-test-user@my-gcp-dev.iam.myaccounts.com does not have storage.objects.delete access'
  }],
  response: undefined,
  message: 'my-test-user@my-gcp-dev.iam.myaccounts.com does not have storage.objects.delete access'
};
let deleteSnapshotEventHandlers = {};
const deleteSnapshotResponse = [{
    on: (event, callback) => {
      _.set(deleteSnapshotEventHandlers, event, callback);
      return true;
    },
    removeAllListeners: () => {
      deleteSnapshotEventHandlers = {};
      return true;
    }
  },
  {
    kind: 'compute#operation',
    id: '333333',
    name: 'operation-xxxxxx',
    operationType: 'delete',
    targetLink: 'https://myaccounts.com/compute/v1/projects/my-gcp-dev/global/snapshots/snapshot-1',
    targetId: '11111',
    status: 'PENDING',
    user: 'my-test-user@my-gcp-dev.iam.myaccounts.com',
    progress: 0,
    insertTime: '2018-03-15T08:31:05.592-07:00',
    selfLink: 'https://myaccounts.com/compute/v1/projects/my-gcp-dev/global/operations/operation-xxxxxx'
  }
];
let streamEventHandlers = {};
const jsonContent = '{"content": "This is a sample content"}';
const streamResponse = {
  on: (event, callback) => {
    _.set(streamEventHandlers, event, callback);
    return true;
  },
  removeListener: (event, callback) => {
    _.unset(streamEventHandlers, event, callback);
    return true;
  },
  end: () => {
    return true;
  }
};
const utilsStreamToPromiseStub = function streamToPromise(stream) {
  return new Promise((resolve, reject) => {
    stream.on('end', () => {
      resolve(jsonContent);
    });
    stream.on('error', (err) => {
      reject(err);
    });
  });
};
const fileStub = {
  delete: () => {
    return Promise.resolve(deleteFileSuccessResponse);
  },
  createWriteStream: () => {
    return streamResponse;
  },
  createReadStream: () => {
    return streamResponse;
  }
};
const fileNotFoundStub = {
  delete: () => {
    return Promise.reject(fileNotFoundResponse);
  }
};
const fileForbiddenStub = {
  delete: () => {
    return Promise.reject(fileForbiddenResponse);
  }
};
const validBlobName = 'blob1.txt';
const notFoundBlobName = 'blob2.txt';
const bucketStub = {
  get: () => {
    return Promise.resolve(bucketMetadataResponse);
  },
  getFiles: () => {
    return Promise.resolve(getFilesResponse);
  },
  file: (file) => {
    if (file === validBlobName) {
      return fileStub;
    } else if (file === notFoundBlobName) {
      return fileNotFoundStub;
    } else {
      return fileForbiddenStub;
    }
  }
};
const snapshotStub = {
  delete: () => {
    return Promise.resolve(deleteSnapshotResponse);
  }
};
const deleteSnapshotErrMsg = 'Delete snapshot failed';
const snapshotFailedStub = {
  delete: () => {
    return Promise.reject(deleteSnapshotErrMsg);
  }
};

describe('iaas', function () {
  describe('GcpClient', function () {
    describe('#ValidateParams', function () {
      it('should throw an error if config not passed', function () {
        expect(() => GcpClient.validateParams(null)).to.throw();
      });
      it('should throw error if projectId is not provided in config', function () {
        var config = {
          name: 'gcp',
          credentials: {
            'type': 'service_account',
            'project_id': 'my-gcp-dev',
            'private_key_id': 'kkkkkkkk',
            'private_key': '-----BEGIN PRIVATE KEY-----\nlllllllllllllllllllllll\n-----END PRIVATE KEY-----\n',
            'client_email': 'my-test-user@my-gcp-dev.iam.myaccounts.com',
            'client_id': '000000000000000',
            'auth_uri': 'https://myaccounts.com/oauth2/auth',
            'token_uri': 'https://myaccounts.com/oauth2/token',
            'auth_provider_x509_cert_url': 'https://myaccounts.com/oauth2/v1/certs',
            'client_x509_cert_url': 'https://myaccounts.com/v1/metadata/x509/my-test-user%40my-gcp-dev.iam.myaccounts.com'
          }
        };
        expect(() => GcpClient.validateParams(config)).to.throw();
      });
      it('should throw error if credentials are not provided in config', function () {
        var config = {
          name: 'gcp',
          projectId: 'my-project-id'
        };
        expect(() => GcpClient.validateParams(config)).to.throw();
      });
      it('should throw an error if credentials object provided in config is missing any params', function () {
        var config = {
          name: 'gcp',
          projectId: 'my-project-id',
          credentials: {
            'type': 'service_account',
            'project_id': 'my-gcp-dev',
            'private_key_id': 'kkkkkkkk',
            'private_key': '-----BEGIN PRIVATE KEY-----\nlllllllllllllllllllllll\n-----END PRIVATE KEY-----\n',
            'client_email': 'my-test-user@my-gcp-dev.iam.myaccounts.com',
            'client_id': '000000000000000',
            'auth_uri': 'https://myaccounts.com/oauth2/auth',
            'token_uri': 'https://myaccounts.com/oauth2/token',
            'auth_provider_x509_cert_url': 'https://myaccounts.com/oauth2/v1/certs',
            // missing client_x509_cert_url param
          }
        };
        expect(() => GcpClient.validateParams(config)).to.throw();
      });
      it('should return true if projectId and credentials are provided in config', function () {
        expect(GcpClient.validateParams(settings)).to.equal(true);
      });
    });

    describe('#GcpStorage', function () {
      it('should form an object with credentials and projectId with storage base url', function () {
        const responseGcpStorageObject = GcpClient.createStorageClient(settings);
        const baseUrl = 'https://www.googleapis.com/storage/v1';

        expect(responseGcpStorageObject.baseUrl).to.equal(baseUrl);
        expect(responseGcpStorageObject.projectId).to.equal(settings.projectId);
        expect(responseGcpStorageObject.authClient.config.projectId).to.equal(settings.projectId);
        expect(responseGcpStorageObject.authClient.config.credentials).to.eql(settings.credentials);
      });
    });

    describe('#GcpCompute', function () {
      it('should form an object with credentials and projectId with compute base url', function () {
        const responseGcpComputeObject = GcpClient.createComputeClient(settings);
        const baseUrl = 'https://www.googleapis.com/compute/v1';

        expect(responseGcpComputeObject.baseUrl).to.equal(baseUrl);
        expect(responseGcpComputeObject.projectId).to.equal(settings.projectId);
        expect(responseGcpComputeObject.authClient.config.credentials).to.eql(settings.credentials);
      });
    });

    describe('#BlobOperations', function () {
      let sandbox, client;
      before(function () {
        sandbox = sinon.sandbox.create();
        client = new GcpClient(settings);
        sandbox.stub(GcpStorage.prototype, 'bucket').withArgs(settings.container).returns(bucketStub);
        sandbox.stub(utils, 'streamToPromise', utilsStreamToPromiseStub);
      });
      after(function () {
        sandbox.restore();
      });
      afterEach(function () {
        streamEventHandlers = {};
      });

      it('container properties should be retrived successfully', function () {
        return client.getContainer()
          .then(result => {
            expect(result.name).to.equal(settings.container);
            expect(result.id).to.equal(settings.container);
            expect(result.location).to.equal(region);
            expect(result.storageClass).to.equal(storageClass);
            expect(result.selfLink).to.equal(storageUrl + bucketUrl + '/' + settings.container);
          })
          .catch(err => {
            logger.error(err);
            throw new Error('expected container properties to be retrived successfully');
          });
      });
      it('list of files/blobs should be returned', function () {
        const options = {
          prefix: 'blob'
        };
        const expectedResponse = [{
            name: 'blob1.txt'
          },
          {
            name: 'blob2.txt'
          }
        ];
        return client.list(options)
          .then(result => {
            expect(result).to.be.an('array');
            expect(result).to.have.lengthOf(2);
            expect(result).to.be.eql(expectedResponse);
          })
          .catch(err => {
            logger.error(err);
            throw new Error('expected list of files/blobs to be returned successfully');
          });
      });
      it('file/blob deletion should be successful', function () {
        return client.remove(validBlobName)
          .then(result => expect(result).to.be.undefined)
          .catch(err => {
            logger.error(err);
            throw new Error('expected file/blob deletion to be successful');
          });
      });
      it('file/blob deletion should be throw NotFound exception', function () {
        return client.remove(notFoundBlobName)
          .then(() => {
            throw new Error('expected file/blob deletion to throw NotFound exception');
          })
          .catch(err => expect(err).to.be.instanceof(NotFound));
      });
      it('file/blob deletion should be throw Forbidden exception', function () {
        return client.remove('some-blob.txt')
          .then(() => {
            throw new Error('expected file/blob deletion to throw Forbidden exception');
          })
          .catch(err => expect(err).to.be.instanceof(Forbidden));
      });
      it('file/blob upload should be successful', function () {
        var uploadJsonPromise = client.uploadJson(validBlobName, jsonContent);
        return Promise.delay(CONNECTION_WAIT_SIMULATED_DELAY)
          .then(() => {
            if (streamEventHandlers.finish && _.isFunction(streamEventHandlers.finish)) {
              return streamEventHandlers.finish.call(streamEventHandlers.finish);
            } else {
              throw new Error('Event Handlers not registered in delete snapshot');
            }
          })
          .then(() => {
            return uploadJsonPromise
              .then(response => expect(response).to.be.eql(jsonContent))
              .catch(err => {
                logger.err(err);
                throw new Error('expected upload to be successful');
              });
          });
      });
      it('file/blob upload should fail', function () {
        const uploadErrMsg = 'Upload failed';
        var uploadJsonPromise = client.uploadJson(validBlobName, jsonContent);
        return Promise.delay(CONNECTION_WAIT_SIMULATED_DELAY)
          .then(() => {
            if (streamEventHandlers.error && _.isFunction(streamEventHandlers.error)) {
              return streamEventHandlers.error.call(streamEventHandlers.error, uploadErrMsg);
            } else {
              throw new Error('Event Handlers not registered in delete snapshot');
            }
          })
          .then(() => {
            return uploadJsonPromise
              .then(() => {
                throw new Error('expected upload to fail');
              })
              .catch(err => expect(err).to.eql(uploadErrMsg));
          });
      });
      it('file/blob download should be successful', function () {
        var downloadJsonPromise = client.downloadJson(validBlobName);
        return Promise.delay(CONNECTION_WAIT_SIMULATED_DELAY)
          .then(() => {
            if (streamEventHandlers.end && _.isFunction(streamEventHandlers.end)) {
              return streamEventHandlers.end.call(streamEventHandlers.end);
            } else {
              throw new Error('Event Handlers not registered in delete snapshot');
            }
          })
          .then(() => {
            return downloadJsonPromise
              .then(response => expect(response).to.eql(JSON.parse(jsonContent)))
              .catch(() => {
                throw new Error('expected download to be successful');
              });
          });
      });
      it('file/blob download should fail', function () {
        const downloadErrMsg = 'Download failed';
        var downloadJsonPromise = client.downloadJson(validBlobName);
        return Promise.delay(CONNECTION_WAIT_SIMULATED_DELAY)
          .then(() => {
            if (streamEventHandlers.error && _.isFunction(streamEventHandlers.error)) {
              return streamEventHandlers.error.call(streamEventHandlers.error, downloadErrMsg);
            } else {
              throw new Error('Event Handlers not registered in delete snapshot');
            }
          })
          .then(() => {
            return downloadJsonPromise
              .then(() => {
                throw new Error('expected download to fail');
              })
              .catch(err => expect(err).to.eql(downloadErrMsg));
          });
      });
      it('file/blob download should fail with NotFound error', function () {
        var downloadJsonPromise = client.downloadJson(validBlobName);
        return Promise.delay(CONNECTION_WAIT_SIMULATED_DELAY)
          .then(() => {
            if (streamEventHandlers.error && _.isFunction(streamEventHandlers.error)) {
              return streamEventHandlers.error.call(streamEventHandlers.error, fileNotFoundResponse);
            } else {
              throw new Error('Event Handlers not registered in delete snapshot');
            }
          })
          .then(() => {
            return downloadJsonPromise
              .then(() => {
                throw new Error('expected download to fail');
              })
              .catch(err => expect(err).to.be.instanceof(NotFound));
          });
      });
      it('file/blob download should fail with UnprocessableEntity error', function () {
        var downloadJsonPromise = client.downloadJson(validBlobName);
        return Promise.delay(CONNECTION_WAIT_SIMULATED_DELAY)
          .then(() => {
            if (streamEventHandlers.error && _.isFunction(streamEventHandlers.error)) {
              return streamEventHandlers.error.call(streamEventHandlers.error, new SyntaxError('Error parsing data'));
            } else {
              throw new Error('Event Handlers not registered in delete snapshot');
            }
          })
          .then(() => {
            return downloadJsonPromise
              .then(() => {
                throw new Error('expected download to fail');
              })
              .catch(err => expect(err).to.be.instanceof(UnprocessableEntity));
          });
      });
    });

    describe('#ComputeOperations', function () {
      let sandbox, client;
      before(function () {
        sandbox = sinon.sandbox.create();
        client = new GcpClient(settings);
        sandbox.stub(GcpCompute.prototype, 'snapshot').returns(snapshotStub);
      });
      after(function () {
        sandbox.restore();
      });
      afterEach(function () {
        deleteSnapshotEventHandlers = {};
      });

      it('snapshot should be deleted successfully', function () {
        var deleteSnapshotPromise = client.deleteSnapshot('snapshot-1');
        return Promise.delay(CONNECTION_WAIT_SIMULATED_DELAY)
          .then(() => {
            if (deleteSnapshotEventHandlers.complete && _.isFunction(deleteSnapshotEventHandlers.complete)) {
              return deleteSnapshotEventHandlers.complete.call(deleteSnapshotEventHandlers.complete);
            } else {
              throw new Error('Event Handlers not registered in delete snapshot');
            }
          })
          .then(() => {
            return deleteSnapshotPromise
              .then(response => expect(response).to.be.undefined)
              .catch(() => {
                throw new Error('expected snapshot delete to be successful');
              });
          });
      });
      it('snapshot delete should fail', function () {
        var deleteSnapshotPromise = client.deleteSnapshot('snapshot-1');
        return Promise.delay(CONNECTION_WAIT_SIMULATED_DELAY)
          .then(() => {
            if (deleteSnapshotEventHandlers.error && _.isFunction(deleteSnapshotEventHandlers.error)) {
              return deleteSnapshotEventHandlers.error.call(deleteSnapshotEventHandlers.error, deleteSnapshotErrMsg);
            } else {
              throw new Error('Event Handlers not registered in delete snapshot');
            }
          })
          .then(() => {
            return deleteSnapshotPromise
              .then(() => {
                throw new Error('expected snapshot delete to fail');
              })
              .catch(err => expect(err).to.eql(deleteSnapshotErrMsg));
          });
      });
      it('snapshot delete request should fail', function () {
        sandbox.restore();
        sandbox.stub(GcpCompute.prototype, 'snapshot').returns(snapshotFailedStub);
        return client.deleteSnapshot('snapshot-1')
          .then(() => {
            throw new Error('expected snapshot delete request to fail');
          })
          .catch(err => expect(err).to.eql(deleteSnapshotErrMsg));
      });
    });
  });
});