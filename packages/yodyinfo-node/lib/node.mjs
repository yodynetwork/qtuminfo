import assert from 'assert'
import EventEmitter from 'events'
import Bus from './bus'
import {Chain} from 'qtuminfo-lib'
import Logger from './logger'

export default class Node extends EventEmitter {
  constructor(config) {
    super()
    this.configPath = config.path
    this.logger = new Logger({formatting: config.formatLogs})
    this.datadir = config.datadir
    this.chain = Chain.get(config.chain)
    this.port = config.port
    this.https = config.https
    this.httpsOptions = config.httpsOptions
    this.services = new Map()
    this.unloadedServices = config.services || []
  }

  openBus({remoteAddress} = {}) {
    return new Bus({node: this, remoteAddress})
  }

  getAllAPIMethods() {
    let methods = {}
    for (let service of this.services.values()) {
      Object.assign(methods, service.APIMethods)
    }
    return methods
  }

  getAllPublishEvents() {
    let events = []
    for (let service of this.services.values()) {
      events.push(...service.publishEvents)
    }
    return events
  }

  static getServiceOrder(services) {
    let names = []
    let servicesByName = {}
    for (let service of services) {
      names.push(service.name)
      servicesByName[service.name] = service
    }
    let stack = []
    let stackNames = new Set()
    function addToStack(names) {
      for (let name of names) {
        let service = servicesByName[name]
        addToStack(service.module.dependencies)
        if (!stackNames.has(name)) {
          stack.push(service)
          stackNames.add(name)
        }
      }
    }
    addToStack(names)
    return stack
  }

  getServicesByOrder() {
    let names = []
    let servicesByName = {}
    for (let [name, service] of this.services) {
      names.push(name)
      servicesByName[name] = service
    }
    let stack = []
    let stackNames = new Set()
    function addToStack(names) {
      for (let name of names) {
        let service = servicesByName[name]
        addToStack(service.constructor.dependencies)
        if (!stackNames.has(name)) {
          stack.push(service)
          stackNames.add(name)
        }
      }
    }
    addToStack(names)
    return stack
  }

  async startService(serviceInfo) {
    this.logger.info('Starting', serviceInfo.name)
    let config = serviceInfo.config || {}
    config.node = this
    config.name = serviceInfo.name
    let service = new serviceInfo.module(config)
    this.services.set(serviceInfo.name, service)
    await service.start()
    let methodNames = new Set()
    for (let [name, method] of Object.entries(service.APIMethods)) {
      assert(!methodNames.has(name), `API method name conflicts: ${name}`)
      methodNames.add(name)
      this[name] = method
    }
  }

  async start() {
    this.logger.info('Using config:', this.configPath)
    this.logger.info('Using chain:', this.chain.name)
    for (let service of Node.getServiceOrder(this.unloadedServices)) {
      await this.startService(service)
    }
    this.emit('ready')
  }

  async stop() {
    if (this.stopping) {
      return
    }
    this.logger.info('Beginning shutdown')
    let services = Node.getServiceOrder(this.unloadedServices).reverse()
    this.stopping = true
    this.emit('stopping')
    for (let service of services) {
      if (this.services.has(service.name)) {
        this.logger.info('Stopping', service.name)
        await this.services.get(service.name).stop()
      } else {
        this.logger.info('Stopping', service.name, '(not started)')
      }
    }
  }
}
