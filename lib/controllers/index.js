'use strict';

const ServiceBrokerApiController = require('./ServiceBrokerApiController');
const ServiceFabrikApiController = require('./ServiceFabrikApiController');
const ServiceFabrikAdminController = require('./ServiceFabrikAdminController');
const DashboardController = require('./DashboardController');
const DirectorProvisioner = require('./DirectorProvisioner');
const DockerProvisioner = require('./DockerProvisioner');
const DefaultBindExecutor = require('./DefaultBindExecutor');

/* Controller classes */
exports.ServiceBrokerApiController = ServiceBrokerApiController;
exports.ServiceFabrikApiController = ServiceFabrikApiController;
exports.ServiceFabrikAdminController = ServiceFabrikAdminController;
exports.DashboardController = DashboardController;
//exports.DirectorProvisionController = DirectorProvisionController;

/* Controller instances */
exports.serviceBrokerApi = new ServiceBrokerApiController();
exports.serviceFabrikApi = new ServiceFabrikApiController();
exports.serviceFabrikAdmin = new ServiceFabrikAdminController();
exports.dashboard = new DashboardController();
exports.directorProvisioner = new DirectorProvisioner();
exports.dockerProvisioner = new DockerProvisioner();
exports.defaultBindExecutor = new DefaultBindExecutor();