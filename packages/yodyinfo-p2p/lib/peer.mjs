import EventEmitter from 'events'
import {Socket} from 'net'
import {BufferReader} from 'qtuminfo-lib'
import Messages from './commands/messages'

const MAX_RECEIVE_BUFFER = 10000000
const status = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  READY: 'ready'
}

export default class Peer extends EventEmitter {
  constructor({socket, host = 'localhost', port = null, chain}) {
    super()
    this.chain = chain
    if (socket) {
      this.socket = socket
      this.host = this.socket.remoteAddress
      this.port = this.socket.remotePort
      this.status = status.CONNECTED
      this.addSocketEventHandlers()
    } else {
      this.host = host
      this.port = port || this.chain.port
      this.status = status.DISCONNECTED
    }
    this.messages = new Messages({chain: this.chain})
    this.receiveBuffer = new BufferReader(Buffer.alloc(0))
    this.bestHeight = 0
    this.version = 0
    this.subversion = null
    this.versionSent = false

    this.on('ping', message => this.sendPong({nonce: message.nonce}))
    this.on('version', message => {
      this.version = message.version
      this.subversion = message.subversion
      this.bestHeight = message.startHeight
      let verackResponse = this.messages.verack()
      this.sendMessage(verackResponse)
      if (!this.versionSent) {
        this.sendVersion()
      }
    })
    this.on('verack', () => {
      this.status = status.READY
      this.emit('ready')
    })
    this.on('reject', message => {
      console.log(message)
    })
  }

  connect() {
    this.socket = new Socket()
    this.status = status.CONNECTING
    this.socket.on('connect', () => {
      this.status = status.CONNECTED
      this.emit('connect')
      this.sendVersion()
    })
    this.addSocketEventHandlers()
    this.socket.connect(this.port, this.host)
  }

  disconnect() {
    this.status = status.DISCONNECTED
    this.socket.destroy()
    this.emit('disconnect')
  }

  addSocketEventHandlers() {
    this.socket.on('data', data => {
      this.receiveBuffer.push(data)
      if (this.receiveBuffer.length > MAX_RECEIVE_BUFFER) {
        this.disconnect()
      } else {
        this.readMessage()
      }
    })
    this.socket.on('end', this.disconnect.bind(this))
    this.socket.on('error', this.onError.bind(this))
  }

  onError(err) {
    this.emit('error', err)
    if (this.status !== status.DISCONNECTED) {
      this.disconnect()
    }
  }

  sendMessage(message) {
    this.socket.write(message.toBuffer())
  }

  sendVersion() {
    let message = this.messages.version()
    this.versionSent = true
    this.sendMessage(message)
  }

  sendPong(nonce) {
    let message = this.messages.pong(nonce)
    this.sendMessage(message)
  }

  readMessage() {
    let message = this.messages.parseBuffer(this.receiveBuffer)
    if (message) {
      this.emit(message.command, message)
      this.readMessage()
    }
  }
}

Peer.status = status
