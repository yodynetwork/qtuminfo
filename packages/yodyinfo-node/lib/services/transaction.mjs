import {Address, Script, Input, Output, Transaction as RawTransaction} from 'qtuminfo-lib'
import Transaction from '../models/transaction'
import TransactionOutput from '../models/transaction-output'
import QtumBalanceChanges from '../models/qtum-balance-changes'
import Service from './base'
import {toBigInt, BigInttoLong} from '../utils'

export default class TransactionService extends Service {
  constructor(options) {
    super(options)
    this._tip = null
  }

  static get dependencies() {
    return ['block', 'db']
  }

  get APIMethods() {
    return {
      getTransaction: this.getTransaction.bind(this),
      getRawTransaction: this.getRawTransaction.bind(this),
      getRecentTransactions: this.getRecentTransactions.bind(this),
      getBlockReward: this.getBlockReward.bind(this),
      searchLogs: this.searchLogs.bind(this)
    }
  }

  async getTransaction(id) {
    let [transaction] = await Transaction.aggregate([
      {$match: {id: id.toString('hex')}},
      {
        $lookup: {
          from: 'transactionoutputs',
          localField: 'id',
          foreignField: 'spent.transactionId',
          as: 'input'
        }
      },
      {$unwind: '$input'},
      {$sort: {'input.index': 1}},
      {
        $group: {
          _id: '$_id',
          id: {$first: '$id'},
          hash: {$first: '$hash'},
          version: {$first: '$version'},
          marker: {$first: '$marker'},
          flag: {$first: '$flag'},
          inputs: {
            $push: {
              prevTxId: '$input.output.transactionId',
              outputIndex: '$input.output.index',
              scriptSig: '$input.spent.scriptSig',
              sequence: '$input.spent.sequence',
              value: '$input.value',
              address: '$input.address'
            }
          },
          witnesses: {$first: '$witnesses'},
          lockTime: {$first: '$lockTime'},
          block: {$first: '$block'},
          size: {$first: '$size'},
          receipts: {$first: '$receipts'}
        }
      },
      {
        $lookup: {
          from: 'transactionoutputs',
          localField: 'id',
          foreignField: 'output.transactionId',
          as: 'output'
        }
      },
      {$unwind: '$output'},
      {
        $lookup: {
          from: 'transactionoutputs',
          localField: 'output.refund',
          foreignField: '_id',
          as: 'refund'
        }
      },
      {$addFields: {refund: {$arrayElemAt: ['$refund', 0]}}},
      {
        $lookup: {
          from: 'transactionoutputs',
          localField: 'output._id',
          foreignField: 'refund',
          as: 'refundTo'
        }
      },
      {$addFields: {isRefund: {$toBool: {$size: '$refundTo'}}}},
      {$sort: {'output.index': 1}},
      {
        $group: {
          _id: '$_id',
          id: {$first: '$id'},
          hash: {$first: '$hash'},
          version: {$first: '$version'},
          marker: {$first: '$marker'},
          flag: {$first: '$flag'},
          inputs: {$first: '$inputs'},
          outputs: {
            $push: {
              value: '$output.value',
              scriptPubKey: '$output.output.scriptPubKey',
              address: '$output.address',
              spentTxId: '$output.spent.transactionId',
              spentIndex: '$output.spent.index',
              refundTxId: '$refund.output.transactionId',
              refundIndex: '$refund.output.index',
              refundValue: '$refund.value',
              isRefund: '$isRefund'
            }
          },
          witnesses: {$first: '$witnesses'},
          lockTime: {$first: '$lockTime'},
          block: {$first: '$block'},
          size: {$first: '$size'},
          receipts: {$first: '$receipts'}
        }
      },
      {
        $lookup: {
          from: 'qtumbalancechanges',
          localField: 'id',
          foreignField: 'id',
          as: 'balanceChanges'
        }
      }
    ]).allowDiskUse(true)

    return {
      id: Buffer.from(transaction.id, 'hex'),
      hash: Buffer.from(transaction.hash, 'hex'),
      version: transaction.version,
      marker: transaction.marker,
      flag: transaction.flag,
      inputs: transaction.inputs.map(input => {
        let result = new Input({
          prevTxId: 'prevTxId' in input ? Buffer.from(input.prevTxId, 'hex') : Buffer.alloc(32),
          outputIndex: 'outputIndex' in input ? input.outputIndex : 0xffffffff,
          scriptSig: Script.fromBuffer(input.scriptSig.buffer),
          sequence: input.sequence
        })
        result.value = toBigInt(input.value)
        if (input.address) {
          result.address = new Address({
            type: input.address.type,
            data: Buffer.from(input.address.hex, 'hex'),
            chain: this.chain
          })
        }
        return result
      }),
      outputs: transaction.outputs.map((output, index) => {
        let result = new Output({
          value: toBigInt(output.value),
          scriptPubKey: Script.fromBuffer(output.scriptPubKey.buffer)
        })
        if (output.spentTxId) {
          result.spentTxId = Buffer.from(output.spentTxId, 'hex')
          result.spentIndex = output.spentIndex
        }
        if (output.refundTxId) {
          result.refundTxId = Buffer.from(output.refundTxId, 'hex')
          result.refundIndex = output.refundIndex
          result.refundValue = toBigInt(output.refundValue)
        }
        result.isRefund = output.isRefund
        result.address = Address.fromScript(result.scriptPubKey, this.chain, Buffer.from(transaction.id, 'hex'), index)
        return result
      }),
      witnesses: transaction.witnesses.map(witness => witness.map(item => item.buffer)),
      lockTime: transaction.lockTime,
      ...transaction.block.height === 0xffffffff
        ? {}
        : {
          block: {
            hash: Buffer.from(transaction.block.hash, 'hex'),
            height: transaction.block.height,
            timestamp: transaction.block.timestamp
          }
        },
      size: transaction.size,
      balanceChanges: transaction.balanceChanges.map(({address, value}) => ({
        address: address
          ? new Address({
            type: address.type,
            data: Buffer.from(address.hex, 'hex'),
            chain: this.chain
          })
          : null,
        value: toBigInt(value)
      })),
      receipts: transaction.receipts.map(({gasUsed, contractAddress, excepted, logs}) => ({
        gasUsed,
        contractAddress: Buffer.from(contractAddress, 'hex'),
        excepted,
        logs: logs.map(({address, topics, data}) => ({
          address: Buffer.from(address, 'hex'),
          topics: topics.map(topic => Buffer.from(topic, 'hex')),
          data: data.buffer
        }))
      }))
    }
  }

  async getRawTransaction(id) {
    let [transaction] = await Transaction.aggregate([
      {$match: {id: id.toString('hex')}},
      {
        $lookup: {
          from: 'transactionoutputs',
          localField: 'id',
          foreignField: 'spent.transactionId',
          as: 'input'
        }
      },
      {$unwind: '$input'},
      {$sort: {'input.index': 1}},
      {
        $group: {
          _id: '$_id',
          id: {$first: '$id'},
          version: {$first: '$version'},
          marker: {$first: '$marker'},
          flag: {$first: '$flag'},
          inputs: {
            $push: {
              prevTxId: '$input.output.transactionId',
              outputIndex: '$input.output.index',
              scriptSig: '$input.spent.scriptSig',
              sequence: '$input.spent.sequence'
            }
          },
          witnesses: {$first: '$witnesses'},
          lockTime: {$first: '$lockTime'}
        }
      },
      {
        $lookup: {
          from: 'transactionoutputs',
          localField: 'id',
          foreignField: 'output.transactionId',
          as: 'output'
        }
      },
      {$unwind: '$output'},
      {$sort: {'output.index': 1}},
      {
        $group: {
          _id: '$_id',
          version: {$first: '$version'},
          marker: {$first: '$marker'},
          flag: {$first: '$flag'},
          inputs: {$first: '$inputs'},
          outputs: {
            $push: {
              value: '$output.value',
              scriptPubKey: '$output.output.scriptPubKey'
            }
          },
          witnesses: {$first: '$witnesses'},
          lockTime: {$first: '$lockTime'}
        }
      }
    ]).allowDiskUse(true)

    return new RawTransaction({
      version: transaction.version,
      marker: transaction.marker,
      flag: transaction.flag,
      inputs: transaction.inputs.map(input => new Input({
        prevTxId: 'prevTxId' in input ? Buffer.from(input.prevTxId, 'hex') : Buffer.alloc(32),
        outputIndex: 'outputIndex' in input ? input.outputIndex : 0xffffffff,
        scriptSig: Script.fromBuffer(input.scriptSig.buffer),
        sequence: input.sequence
      })),
      outputs: transaction.outputs.map(output => new Output({
        value: toBigInt(output.value),
        scriptPubKey: Script.fromBuffer(output.scriptPubKey.buffer)
      })),
      witnesses: transaction.witnesses.map(witness => witness.map(item => item.buffer)),
      lockTime: transaction.lockTime
    })
  }

  async getRecentTransactions(limit = 10) {
    let ids = await Transaction.collection
      .find(
        {
          $or: [
            {'block.height': {$gt: 0, $lte: 5000}, index: {$gt: 0}},
            {'block.height': {$gt: 5000}, index: {$gt: 1}},
            {'block.height': 0xffffffff}
          ]
        },
        {
          sort: {'block.height': -1, index: -1},
          limit,
          projection: {_id: false, id: true}
        }
      )
      .map(({id}) => id)
      .toArray()
    return await Promise.all(ids.map(id => this.getTransaction(Buffer.from(id, 'hex'))))
  }

  async getBlockReward(height, isProofOfStake = true) {
    if (height === 0) {
      return 0n
    }
    let transaction = await Transaction.collection.findOne(
      {'block.height': height, index: isProofOfStake ? 1 : 0},
      {projection: {_id: false, id: true}}
    )
    if (!transaction) {
      return
    }
    let [{inputValue}] = await TransactionOutput.aggregate([
      {$match: {'spent.transactionId': transaction.id}},
      {
        $group: {
          _id: null,
          inputValue: {$sum: '$value'}
        }
      }
    ])
    let [{outputValue}] = await TransactionOutput.aggregate([
      {$match: {'output.transactionId': transaction.id}},
      {
        $lookup: {
          from: 'transactionoutputs',
          localField: '_id',
          foreignField: 'refund',
          as: 'refundTo'
        }
      },
      {$match: {refundTo: []}},
      {
        $group: {
          _id: null,
          outputValue: {$sum: '$value'}
        }
      }
    ])
    return toBigInt(outputValue) - toBigInt(inputValue)
  }

  async searchLogs({
    fromBlock, toBlock,
    contractAddresses,
    addresses, topics,
    pageIndex = 0, pageSize = 100, reversed = false
  }) {
    let elemFilter = {}
    let filter = {}
    let logsFilter = {}
    if (fromBlock != null || toBlock != null) {
      elemFilter['block.height'] = {}
      if (fromBlock != null) {
        elemFilter['block.height'].$gte = fromBlock
      }
      if (toBlock != null) {
        elemFilter['block.height'].$lte = toBlock
      }
    }
    if (contractAddresses || addresses || topics) {
      elemFilter.receipts = {$elemMatch: {excepted: 'None'}}
      let nestedFilter = elemFilter.receipts.$elemMatch
      if (Array.isArray(contractAddresses)) {
        contractAddresses = contractAddresses.map(address => address.toString('hex'))
        nestedFilter.contractAddresses = {$in: contractAddresses}
        filter['receipts.contractAddress'] = {$in: contractAddresses}
      } else if (contractAddresses) {
        contractAddresses = contractAddresses.toString('hex')
        nestedFilter.contractAddresses = contractAddresses
        filter['receipts.contractAddress'] = contractAddresses
      }
      if (addresses || topics) {
        nestedFilter.logs = {$elemMatch: {}}
        if (Array.isArray(addresses)) {
          addresses = addresses.map(address => address.toString('hex'))
          nestedFilter.logs.$elemMatch.addresses = {$in: addresses}
          filter['receipts.logs.address'] = {$in: addresses}
          logsFilter['$$log.address'] = {$in: addresses}
        } else if (addresses) {
          addresses = addresses.toString('hex')
          nestedFilter.logs.$elemMatch.addresses = addresses
          filter['receipts.logs.address'] = addresses
          logsFilter['$$log.address'] = addresses
        }
        if (topics) {
          if (!Array.isArray(topics)) {
            topics = [topics]
          }
          let topicElementFilter = {}
          let topicFilter = {}
          if (topics.length === 1) {
            topics = topics[0]
            if (Array.isArray(topics)) {
              topics = topics.map(topic => topic.toString('hex'))
              topicElementFilter.$and = topics.map(topic => ({topics: topic}))
              topicFilter.$and = topics.map(topic => ({'receipts.logs.topics': topic}))
              logsFilter.$and = topics.map(topic => ({'$$log.topics': topic}))
            } else {
              topics = topics.toString('hex')
              topicElementFilter.topics = topics
              topicFilter.topics = topics
              logsFilter['$$log.topics'] = topics
            }
          } else {
            topicElementFilter.$or = topics.map(topics => {
              if (Array.isArray(topics)) {
                return {$and: topics.map(topic => ({topics: topic.toString('hex')}))}
              } else {
                return {topics: topics.toString('hex')}
              }
            })
            topicFilter.$or = topics.map(topics => {
              if (Array.isArray(topics)) {
                return {$and: topics.map(topic => ({'receipts.logs.topics': topic.toString('hex')}))}
              } else {
                return {'receipts.logs.topics': topics.toString('hex')}
              }
            })
            logsFilter.$or = topics.map(topics => {
              if (Array.isArray(topics)) {
                return {$and: topics.map(topic => ({'$$log.topics': topic.toString('hex')}))}
              } else {
                return {'$$log.topics': topics.toString('hex')}
              }
            })
          }
          Object.assign(nestedFilter.logs.$elemMatch, topicElementFilter)
          Object.assign(filter, topicFilter)
        }
      } else {
        nestedFilter.logs = {$ne: []}
      }
    }

    let result = await Transaction.aggregate([
      {$match: elemFilter},
      {
        $project: {
          _id: false,
          id: '$id',
          block: {
            hash: '$block.hash',
            height: '$block.height'
          },
          index: '$index',
          receipts: '$receipts'
        }
      },
      {$unwind: {path: '$receipts', includeArrayIndex: 'receiptIndex'}},
      {$match: filter},
      {
        $sort: reversed
          ? {'block.height': -1, index: -1, receiptIndex: -1}
          : {'block.height': 1, index: 1, receiptIndex: 1}
      },
      {$skip: pageIndex * pageSize},
      {$limit: pageSize},
      {
        $project: {
          id: '$id',
          block: '$block',
          contractAddress: '$receipt.contractAddress',
          logs: {
            $filter: {
              input: '$receipts.logs',
              as: 'log',
              cond: logsFilter
            }
          }
        }
      }
    ])

    return result.map(({id, block, contractAddress, logs}) => ({
      id: Buffer.from(id, 'hex'),
      block: {
        height: block.height,
        hash: Buffer.from(block.hash, 'hex')
      },
      contractAddress: Buffer.from(contractAddress, 'hex'),
      logs: logs.map(({address, topics, data}) => ({
        address: Buffer.from(address, 'hex'),
        topics: topics.map(topic => Buffer.from(topic, 'hex')),
        data: data.buffer
      }))
    }))
  }

  async start() {
    this._tip = await this.node.getServiceTip(this.name)
    let blockTip = this.node.getBlockTip()
    if (this._tip.height > blockTip.height) {
      this._tip = {height: blockTip.height, hash: blockTip.hash}
    }
    await Transaction.deleteMany({'block.height': {$gt: this._tip.height}})
    await TransactionOutput.bulkWrite([
      {deleteMany: {filter: {'output.height': {$gt: this._tip.height}}}},
      {
        updateMany: {
          filter: {'spent.height': {$gt: this._tip.height}},
          update: {$unset: {spent: ''}}
        }
      }
    ])
    await QtumBalanceChanges.deleteMany({'block.height': {$gt: this._tip.height}})
    await this.node.updateServiceTip(this.name, this._tip)
  }

  async onReorg(height) {
    let outputTransactionIds = await Transaction.collection
      .find(
        {
          'block.height': {$gt: height},
          index: {$in: [0, 1]}
        },
        {$projection: {_id: false, id: true}}
      )
      .map(document => document.id)
      .toArray()
    await Transaction.bulkWrite([
      {deleteMany: {filter: {id: {$in: outputTransactionIds}}}},
      {
        updateMany: {
          filter: {'block.height': {$gt: height}},
          update: {block: {height: 0xffffffff}}
        }
      }
    ])
    await TransactionOutput.bulkWrite([
      {deleteMany: {filter: {'output.transactionId': {$in: outputTransactionIds}}}},
      {
        updateMany: {
          filter: {'output.height': {$gt: height}},
          update: {'output.height': 0xffffffff}
        }
      },
      {
        updateMany: {
          filter: {'spent.height': {$gt: height}},
          update: {'spent.height': 0xffffffff}
        }
      }
    ])
    await QtumBalanceChanges.bulkWrite([
      {deleteMany: {filter: {id: {$in: outputTransactionIds}}}},
      {
        updateMany: {
          filter: {'block.height': {$gt: this._tip.height}},
          update: {block: {height: 0xffffffff}}
        }
      }
    ])
  }

  async onBlock(block) {
    if (this.node.stopping) {
      return
    }
    for (let i = 0; i < block.transactions.length; ++i) {
      await this._processTransaction(block.transactions[i], i, block)
    }
    this._tip.height = block.height
    this._tip.hash = block.hash
    await this.node.updateServiceTip(this.name, this._tip)
  }

  async _processTransaction(tx, indexInBlock, block) {
    let resultTransaction = await Transaction.findOne({id: tx.id})
    if (resultTransaction) {
      await QtumBalanceChanges.updateMany(
        {id: tx.id},
        {
          block: {
            hash: block.hash,
            height: block.height,
            timestamp: block.header.timestamp
          }
        }
      )
      await TransactionOutput.bulkWrite([
        {
          updateMany: {
            filter: {'spent.transactionId': tx.id},
            update: {'spent.height': block.height}
          }
        },
        {
          updateMany: {
            filter: {'output.transactionId': tx.id},
            update: {'output.height': block.height}
          }
        }
      ])
      resultTransaction.block = {
        hash: block.hash,
        height: block.height,
        timestamp: block.header.timestamp
      }
      resultTransaction.index = indexInBlock
      await resultTransaction.save()
      return
    }

    let inputOperations = tx.inputs.map((input, index) => {
      if (Buffer.compare(input.prevTxId, Buffer.alloc(32)) === 0 && input.outputIndex === 0xffffffff) {
        return {
          insertOne: {
            document: {
              spent: {
                height: block.height,
                transactionId: tx.id,
                index,
                scriptSig: input.scriptSig.toBuffer(),
                sequence: input.sequence
              }
            }
          }
        }
      } else {
        return {
          updateOne: {
            filter: {
              'output.transactionId': input.prevTxId,
              'output.index': input.outputIndex
            },
            update: {
              spent: {
                height: block.height,
                transactionId: tx.id,
                index,
                scriptSig: input.scriptSig.toBuffer(),
                sequence: input.sequence
              }
            }
          }
        }
      }
    })
    await TransactionOutput.bulkWrite(inputOperations, {ordered: false})

    let outputTxos = tx.outputs.map((output, index) => {
      let address = Address.fromScript(output.scriptPubKey, this.chain, tx.id, index)
      if (address) {
        if (address.type === Address.PAY_TO_PUBLIC_KEY) {
          address.type = Address.PAY_TO_PUBLIC_KEY_HASH
        } else if ([Address.CONTRACT_CREATE, Address.CONTRACT_CALL].includes(address.type)) {
          address.type = Address.CONTRACT
        }
      }
      return {
        output: {
          height: block.height,
          transactionId: tx.id,
          index,
          scriptPubKey: output.scriptPubKey.toBuffer()
        },
        value: output.value,
        ...address ? {address: {type: address.type, hex: address.data}} : {},
        isStake: tx.outputs[0].scriptPubKey.isEmpty()
      }
    })
    await TransactionOutput.insertMany(outputTxos, {ordered: false})

    let relatedAddresses = []
    if (block.height > 0) {
      let balanceChanges = await this.getBalanceChanges(tx.id)
      for (let item of balanceChanges) {
        item.id = tx.id.toString('hex')
        item.block = {
          hash: block.hash.toString('hex'),
          height: block.height,
          timestamp: block.header.timestamp
        }
        item.index = indexInBlock
        item.value = BigInttoLong(toBigInt(item.value))
        if (item.address) {
          relatedAddresses.push(item.address)
        }
      }
      await QtumBalanceChanges.collection.insertMany(balanceChanges, {ordered: false})
    }

    await Transaction.create({
      id: tx.id,
      hash: tx.hash,
      version: tx.version,
      marker: tx.marker,
      flag: tx.flag,
      witnesses: tx.witnesses,
      lockTime: tx.lockTime,
      block: {
        hash: block.hash,
        height: block.height,
        timestamp: block.header.timestamp
      },
      index: indexInBlock,
      size: tx.size,
      weight: tx.weight,
      relatedAddresses
    })
  }

  async removeReplacedTransactions(tx) {
    let replacedTransactions = await TransactionOutput.collection.distinct(
      'spent.transactionId',
      {
        $or: tx.inputs.map(input => ({
          'output.transactionId': input.prevTxId.toString('hex'),
          'output.index': input.outputIndex
        })),
        spent: {$ne: null}
      }
    )
    while (replacedTransactions.length !== 0) {
      let id = replacedTransactions.pop()
      replacedTransactions.push(...await TransactionOutput.collection.distinct(
        'spent.transactionId',
        {'output.transactionId': id}
      ))
      await Transaction.deleteMany({id})
      await TransactionOutput.bulkWrite([
        {deleteMany: {filter: {'output.transactionId': id}}},
        {
          updateMany: {
            filter: {'spent.transactionId': id},
            update: {$unset: {spent: ''}}
          }
        }
      ])
      await QtumBalanceChanges.deleteMany({id})
    }
  }

  async getBalanceChanges(id) {
    id = id.toString('hex')
    return await TransactionOutput.aggregate([
      {
        $match: {
          $or: [
            {'output.transactionId': id},
            {'spent.transactionId': id}
          ]
        }
      },
      {
        $group: {
          _id: '$address',
          value: {
            $sum: {
              $cond: {
                if: {$eq: ['$spent.transactionId', id]},
                then: {$subtract: [0, '$value']},
                else: '$value'
              }
            }
          }
        }
      },
      {
        $project: {
          _id: false,
          address: '$_id',
          value: '$value'
        }
      }
    ])
  }
}
