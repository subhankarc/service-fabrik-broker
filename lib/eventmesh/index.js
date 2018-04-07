'use strict';

const EtcdEventMeshServer = require('./EtcdEventMeshServer');
const Etcd3EventMeshServer = require('./Etcd3EventMeshServer');

// exports.server = new EtcdEventMeshServer();
exports.server = new Etcd3EventMeshServer();