import WebSocket from 'ws'
import {Transaction, Address} from 'qtuminfo-lib'
import Service from 'qtuminfo-node/lib/services/base'

export default class QtuminfoWebsocketService extends Service {
  constructor(options) {
    super(options)
    this._options = options
  }

  static get dependencies() {
    return ['block', 'header', 'mempool', 'web']
  }

  get routePrefix() {
    return this._routePrefix
  }

  async start() {
    this._bus = this.node.openBus({remoteAddress: 'localhost-qtuminfo-ws'})
    this._bus.on('block/block', this._blockEventHandler.bind(this))
    this._bus.subscribe('block/block')
    this._bus.on('block/transaction', this._transactionEventHandler.bind(this))
    this._bus.subscribe('block/transaction')
    this._bus.on('mempool/transaction', this._mempoolTransactionEventHandler.bind(this))
    this._bus.subscribe('mempool/transaction')
    this._bus.on('block/address', this._addressesEventHandler.bind(this))
    this._bus.subscribe('block/address')
    this._bus.on('mempool/address', this._addressesEventHandler.bind(this))
    this._bus.subscribe('mempool/address')

    this._server = new WebSocket.Server({port: this._options.port})
    this._server.on('connection', ws => {
      ws.subscriptions = new Set(['height'])
      ws.send(JSON.stringify({
        type: 'height',
        data: this.node.getBlockTip().height
      }))
      ws.on('message', message => {
        try {
          message = JSON.parse(message)
          if (message === 'ping') {
            ws.send(JSON.stringify('pong'))
          } else if (message.type === 'subscribe') {
            ws.subscriptions.add(message.data)
          } else if (message.type === 'unsubscribe') {
            ws.subscriptions.delete(message.data)
          }
        } catch (err) {}
      })
      ws.on('close', () => {})
      ws.on('error', () => {})
    })
  }

  async stop() {
    this._server.close()
  }

  getRemoteAddress(req) {
    return req.headers['x-real-ip'] || req.socket.remoteAddress
  }

  async _blockEventHandler(block) {
    for (let client of this._server.clients) {
      if (client.subscriptions.has('height')) {
        client.send(JSON.stringify({
          type: 'height',
          data: block.height
        }))
      }
    }
    let transformedBlock
    for (let client of this._server.clients) {
      if (client.subscriptions.has('block')) {
        if (!transformedBlock) {
          transformedBlock = await this._transformBlock(await this.node.getBlock(block.hash))
        }
        client.send(JSON.stringify({
          type: 'block',
          data: transformedBlock
        }))
      }
    }
  }

  async _transactionEventHandler(transaction) {
    let id = transaction.id.toString('hex')
    let transformedTransaction
    for (let client of this._server.clients) {
      if (client.subscriptions.has(`transaction/${id}`)) {
        if (!transformedTransaction) {
          transformedTransaction = await this._transformTransaction(transaction)
        }
        client.send(JSON.stringify({
          type: `transaction/${id}`,
          data: transformedTransaction
        }))
      }
    }
  }

  async _mempoolTransactionEventHandler(transaction) {
    let transformedTransaction
    for (let client of this._server.clients) {
      if (client.subscriptions.has('mempool/transaction')) {
        if (!transformedTransaction) {
          transformedTransaction = await this._transformTransaction(transaction)
        }
        client.send(JSON.stringify({
          type: 'mempool/transaction',
          data: transformedTransaction
        }))
      }
    }
  }

  async _addressesEventHandler(type, ...args) {
    if (type === 'transaction') {
      let [transaction, addresses] = args
      let transformedTransaction
      for (let client of this._server.clients) {
        for (let address of addresses) {
          if (client.subscriptions.has(`address/${address}/transaction`)) {
            if (!transformedTransaction) {
              transformedTransaction = await this._transformTransaction(transaction)
            }
            client.send(JSON.stringify({
              type: `address/${address}/transaction`,
              data: transformedTransaction
            }))
          }
        }
      }
    }
  }

  async _transformBlock(block) {
    let reward = await this.node.getBlockReward(block.height, block.isProofOfStake)
    return {
      hash: block.hash.toString('hex'),
      height: block.height,
      version: block.version,
      prevHash: block.prevHash.toString('hex'),
      nextHash: block.nextHash && block.nextHash.toString('hex'),
      merkleRoot: block.merkleRoot.toString('hex'),
      timestamp: block.timestamp,
      bits: block.bits,
      nonce: block.nonce,
      hashStateRoot: block.hashStateRoot.toString('hex'),
      hashUTXORoot: block.hashUTXORoot.toString('hex'),
      prevOutStakeHash: block.prevOutStakeHash.toString('hex'),
      prevOutStakeN: block.prevOutStakeN,
      signature: block.signature.toString('hex'),
      chainwork: block.chainwork.toString(16).padStart(64, '0'),
      interval: block.interval,
      size: block.size,
      weight: block.weight,
      transactions: block.transactions.map(id => id.toString('hex')),
      miner: block.miner.toString(),
      coinstakeValue: block.coinstakeValue && block.coinstakeValue.toString(),
      difficulty: block.difficulty,
      reward: reward.toString(),
      confirmations: this.node.getBlockTip().height - block.height + 1
    }
  }

  async _transformTransaction(transaction) {
    let confirmations = 'block' in transaction ? this.node.getBlockTip().height - transaction.block.height + 1 : 0
    let inputValue = transaction.inputs.map(input => input.value).reduce((x, y) => x + y)
    let outputValue = transaction.outputs.map(output => output.value).reduce((x, y) => x + y)
    let refundValue = transaction.outputs
      .map(output => output.refundValue)
      .filter(Boolean)
      .reduce((x, y) => x + y, 0n)
    let refundToValue = transaction.outputs
      .filter(output => output.isRefund)
      .map(output => output.value)
      .reduce((x, y) => x + y, 0n)
    let transformed = {
      id: transaction.id.toString('hex'),
      hash: transaction.hash.toString('hex'),
      version: transaction.version,
      inputs: [],
      outputs: [],
      witnesses: transaction.witnesses.map(witness => witness.map(item => item.toString('hex'))),
      lockTime: transaction.lockTime,
      blockHash: transaction.block && transaction.block.hash.toString('hex'),
      blockHeight: transaction.block && transaction.block.height,
      confirmations,
      timestamp: transaction.block && transaction.block.timestamp,
      isCoinbase: Transaction.prototype.isCoinbase.call(transaction),
      isCoinstake: Transaction.prototype.isCoinstake.call(transaction),
      inputValue: inputValue.toString(),
      outputValue: outputValue.toString(),
      refundValue: refundValue.toString(),
      fees: (inputValue - outputValue - refundValue + refundToValue).toString(),
      size: transaction.size,
      receipts: transaction.receipts.map(({gasUsed, contractAddress, excepted, logs}) => ({
        gasUsed,
        contractAddress: contractAddress.toString('hex'),
        excepted,
        logs: logs.map(({address, topics, data}) => ({
          address: address.toString('hex'),
          topics: topics.map(topic => topic.toString('hex')),
          data: data.toString('hex')
        }))
      }))
    }

    let invalidContracts = {}
    if (transformed.isCoinbase) {
      transformed.inputs.push({
        coinbase: transaction.inputs[0].scriptSig.toBuffer().toString('hex'),
        sequence: transaction.inputs[0].sequence,
        index: 0
      })
    } else {
      for (let index = 0; index < transaction.inputs.length; ++index) {
        let input = transaction.inputs[index]
        let transformedInput = {
          prevTxId: input.prevTxId.toString('hex'),
          outputIndex: input.outputIndex,
          value: input.value.toString(),
          address: input.address && input.address.toString(),
          sequence: input.sequence,
          index,
          scriptSig: {
            hex: input.scriptSig.toBuffer().toString('hex'),
            asm: input.scriptSig.toString()
          }
        }
        if (input.address && input.address.type === Address.CONTRACT) {
          if (transformedInput.address in invalidContracts) {
            transformedInput.isInvalidContract = invalidContracts[transformedInput.address]
          } else {
            invalidContracts[transformedInput.address] = !await this.node.getContract(input.address.data)
            transformedInput.isInvalidContract = invalidContracts[transformedInput.address]
          }
        }
        transformed.inputs.push(transformedInput)
      }
    }
    for (let index = 0; index < transaction.outputs.length; ++index) {
      let output = transaction.outputs[index]
      let type
      let address = Address.fromScript(output.scriptPubKey, this.chain, transaction.id, index)
      if (address) {
        type = address.type
      } else if (output.scriptPubKey.isDataOut()) {
        type = 'nulldata'
      } else {
        type = 'nonstandard'
      }
      let transformedOutput = {
        value: output.value.toString(),
        address: output.address && output.address.toString(),
        index,
        scriptPubKey: {
          type,
          hex: output.scriptPubKey.toBuffer().toString('hex'),
          asm: output.scriptPubKey.toString()
        }
      }
      if (output.spentTxId) {
        transformedOutput.spentTxId = output.spentTxId.toString('hex')
        transformedOutput.spentIndex = output.spentIndex
      }
      if (address && [Address.CONTRACT_CREATE, Address.CONTRACT_CALL].includes(address.type)) {
        if (transformedOutput.address in invalidContracts) {
          if (invalidContracts[transformedOutput.address]) {
            transformedOutput.isInvalidContract = true
          }
        } else {
          invalidContracts[transformedOutput.address] = !await this.node.getContract(address.data)
          transformedOutput.isInvalidContract = invalidContracts[transformedOutput.address]
        }
      }
      transformed.outputs.push(transformedOutput)
    }

    let qrc20TokenTransfers = await this.node.getQRC20TokenTransfers(transaction)
    transformed.qrc20TokenTransfers = qrc20TokenTransfers.map(({token, from, to, amount}) => ({
      token: {
        address: token.address.toString('hex'),
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
        totalSupply: token.totalSupply == null ? null : token.totalSupply.toString(),
        version: token.version
      },
      from: from && from.toString(),
      to: to && to.toString(),
      amount: amount.toString()
    }))
    let qrc721TokenTransfers = await this.node.getQRC721TokenTransfers(transaction)
    transformed.qrc721TokenTransfers = qrc721TokenTransfers.map(({token, from, to, tokenId}) => ({
      token: {
        address: token.address.toString('hex'),
        name: token.name,
        symbol: token.symbol,
        totalSupply: token.totalSupply == null ? null : token.totalSupply.toString()
      },
      from: from && from.toString(),
      to: to && to.toString(),
      tokenId: tokenId.toString('hex')
    }))

    return transformed
  }
}
